import { computed, ref, type Ref } from "vue";
import { HIGHLIGHT_EASING, HIGHLIGHT_MS, planHighlightMove } from "./highlightMotion.ts";

export type OutlineBox = { x: number; y: number; width: number; height: number; ready: boolean };

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
