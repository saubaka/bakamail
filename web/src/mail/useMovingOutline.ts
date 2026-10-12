import { computed, ref, type Ref } from "vue";
import { HIGHLIGHT_EASING, HIGHLIGHT_MS, planHighlightMove } from "./highlightMotion.ts";

export type OutlineBox = { x: number; y: number; width: number; height: number; ready: boolean };

/**
 * 一圈会移动的选中线条：容器里有一个绝对定位的线条元素，目标按钮由选择器给出。
 * 目标变化时从线条此刻真实的位置滑到新按钮；窗口、侧栏尺寸变化只重新量位置、不播放动画。
 */
export function useMovingOutline(options: {
  container: Ref<HTMLElement | null>;
  highlight: Ref<HTMLElement | null>;
  targetSelector: () => string | null;
  reduced: () => boolean;
}) {
  const box = ref<OutlineBox>({ x: 0, y: 0, width: 0, height: 0, ready: false });
  const style = computed(() => ({
    width: `${box.value.width}px`,
    height: `${box.value.height}px`,
    transform: `translate3d(${box.value.x}px,${box.value.y}px,0)`,
  }));
  let frame = 0;
  // 一次“要播放动画”的测量不能被紧随其后的普通测量顶掉，否则线条会直接瞬移到目标。
  let animateRequested = false;

  function measure(animate = false): void {
    animateRequested = animateRequested || animate === true;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const play = animateRequested;
      animateRequested = false;
      const container = options.container.value;
      const selector = options.targetSelector();
      const target = container && selector ? container.querySelector<HTMLElement>(selector) : null;
      if (!container || !target || target.offsetWidth === 0 || target.offsetHeight === 0) {
        box.value = { ...box.value, ready: false };
        return;
      }
      // 按真实盒子量（含小数），并除掉容器自身的缩放（入场动画期间容器可能带缩放），线条才能严丝合缝地圈住按钮。
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const scaleX = container.offsetWidth ? containerRect.width / container.offsetWidth : 1;
      const scaleY = container.offsetHeight ? containerRect.height / container.offsetHeight : 1;
      const next: OutlineBox = {
        x: (targetRect.left - containerRect.left) / scaleX - container.clientLeft,
        y: (targetRect.top - containerRect.top) / scaleY - container.clientTop,
        width: targetRect.width / scaleX,
        height: targetRect.height / scaleY,
        ready: true,
      };
      const element = options.highlight.value;
      if (play && box.value.ready && element && !options.reduced() && typeof element.animate === "function") {
        // 从线条此刻真实的位置出发（连续点击时不会跳回上一个终点）。
        const current = element.getBoundingClientRect();
        const from = {
          x: (current.left - containerRect.left) / scaleX - container.clientLeft,
          y: (current.top - containerRect.top) / scaleY - container.clientTop,
          width: current.width / scaleX,
          height: current.height / scaleY,
        };
        for (const running of element.getAnimations()) running.cancel();
        const plan = planHighlightMove(from, next);
        if (plan) element.animate(plan, { duration: HIGHLIGHT_MS, easing: HIGHLIGHT_EASING });
      }
      box.value = next;
    });
  }

  function dispose(): void { cancelAnimationFrame(frame); }
  return { box, style, measure, dispose };
}
