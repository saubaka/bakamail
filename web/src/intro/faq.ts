/**
 * 常见问题的展开与收起：回答从问题下方“拉出来”（高度和透明度渐变），收起时再收回去。
 * 用原生 details，键盘、读屏、无脚本时的行为都不变；动画只是在点击时接管开合。
 */
export const FAQ_OPEN_MS = 460;
export const FAQ_CLOSE_MS = 340;
export const FAQ_EASING = "cubic-bezier(.2,.8,.2,1)";

export type FaqFrames = { frames: Keyframe[]; duration: number };

/** 回答区域的动画帧：from、to 是当前高度和目标高度（像素）。 */
export function faqFrames(opening: boolean, from: number, to: number): FaqFrames {
  return opening
    ? { frames: [{ height: `${from}px`, opacity: from === 0 ? 0 : 0.6 }, { height: `${to}px`, opacity: 1 }], duration: FAQ_OPEN_MS }
    : { frames: [{ height: `${from}px`, opacity: 1 }, { height: `${to}px`, opacity: 0 }], duration: FAQ_CLOSE_MS };
}

/** 里面的文字随回答一起轻轻落下，不是整块硬切。 */
export function faqTextFrames(opening: boolean): Keyframe[] {
  return opening
    ? [{ opacity: 0, transform: "translate3d(0, -10px, 0)" }, { opacity: 1, transform: "none" }]
    : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate3d(0, -6px, 0)" }];
}

function reducedMotion(): boolean {
  const root = document.documentElement;
  return root.dataset.motion === "reduce" || root.dataset.performance === "low"
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("animate" in Element.prototype);
}

const running = new WeakMap<HTMLDetailsElement, Animation[]>();

function cancelRunning(details: HTMLDetailsElement): void {
  for (const animation of running.get(details) ?? []) animation.cancel();
  running.delete(details);
}

/** 点击问题：展开或收起，并播放动画。连点时从当前高度接着走，不会跳。 */
export function toggleFaq(details: HTMLDetailsElement): void {
  const answer = details.querySelector<HTMLElement>(".intro-faq-answer");
  const closing = details.open && !details.hasAttribute("data-closing");
  if (!answer || reducedMotion()) {
    cancelRunning(details);
    details.removeAttribute("data-closing");
    details.open = !closing;
    return;
  }
  const from = running.has(details) ? answer.getBoundingClientRect().height : closing ? answer.scrollHeight : 0;
  cancelRunning(details);
  if (closing) details.setAttribute("data-closing", "");
  else { details.removeAttribute("data-closing"); details.open = true; }
  const to = closing ? 0 : answer.scrollHeight;
  const { frames, duration } = faqFrames(!closing, from, to);
  const text = answer.firstElementChild as HTMLElement | null;
  const animations = [answer.animate(frames, { duration, easing: FAQ_EASING })];
  if (text) animations.push(text.animate(faqTextFrames(!closing), { duration, easing: FAQ_EASING }));
  running.set(details, animations);
  animations[0]!.finished.then(() => {
    if (running.get(details) !== animations) return;
    running.delete(details);
    for (const animation of animations) animation.cancel();
    if (closing) { details.open = false; details.removeAttribute("data-closing"); }
  }).catch(() => undefined);
}
