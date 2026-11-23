const TOP = 76;
const REVEAL = 18;
const MIN_STACK_WIDTH = 600;
const MIN_VIEWPORT_WIDTH = 761;
const APPROACH_DISTANCE = 200;

export function observeCyberProjectStack(stack: HTMLElement): () => void {
  const cards = Array.from(stack.querySelectorAll<HTMLElement>(":scope > .cyber-project-card"));
  if (cards.length < 2) return () => {};

  const pane = stack.closest<HTMLElement>("[data-showcase-scroll]");
  const scrollTarget = pane ?? window;
  const tops = cards.map((_, index) => TOP + Math.min(index, 4) * REVEAL);
  let stacked = false;
  let scrollFrame = 0;
  let focusFrame = 0;

  const updateDepth = () => {
    scrollFrame = 0;
    if (!stacked) return;
    const bounds = stack.getBoundingClientRect();
    const viewport = pane?.getBoundingClientRect();
    if (bounds.bottom < (viewport?.top ?? 0) || bounds.top > (viewport?.bottom ?? window.innerHeight)) return;

    const positions = cards.map(card => card.getBoundingClientRect().top);
    cards.slice(0, -1).forEach((card, index) => {
      const reveal = tops[index + 1] - tops[index];
      const gap = positions[index + 1] - positions[index] - reveal;
      const progress = 1 - Math.max(0, Math.min(1, gap / APPROACH_DISTANCE));
      card.style.setProperty("--cyber-card-scale", String(1 - 0.03 * progress));
    });
  };
  const scheduleDepth = () => {
    if (stacked && !scrollFrame) scrollFrame = window.requestAnimationFrame(updateDepth);
  };
  const updateLayout = () => {
    const heights = cards.map(card => card.offsetHeight);
    stacked = window.innerWidth >= MIN_VIEWPORT_WIDTH
      && stack.clientWidth >= MIN_STACK_WIDTH
      && heights.every((height, index) => height > 0 && height + tops[index] + 24 <= (pane?.clientHeight ?? window.innerHeight))
      && !stack.querySelector("details[open], :focus-visible");
    stack.toggleAttribute("data-stacked", stacked);
    if (!stacked) {
      cards.forEach(card => card.style.removeProperty("--cyber-card-scale"));
      return;
    }

    // Keep the last card pinned briefly, even when it is shorter than the cards behind it.
    const hold = Math.max(140, Math.max(...heights) - heights[heights.length - 1] + 80);
    stack.style.setProperty("--cyber-stack-end-space", `${hold}px`);
    scheduleDepth();
  };
  const keepControlVisible = (control: HTMLElement | null) => {
    control?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  };
  const onToggle = (event: Event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement)) return;
    const wasStacked = stacked;
    updateLayout();
    if (wasStacked && details.open) keepControlVisible(details.querySelector("summary"));
  };
  const onFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(":focus-visible")) return;
    updateLayout();
    keepControlVisible(event.target);
  };
  const onFocusOut = () => {
    window.cancelAnimationFrame(focusFrame);
    focusFrame = window.requestAnimationFrame(updateLayout);
  };

  cards.forEach((card, index) => card.style.setProperty("--cyber-card-top", `${tops[index]}px`));
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(updateLayout) : null;
  observer?.observe(stack);
  cards.forEach(card => observer?.observe(card));
  stack.addEventListener("toggle", onToggle, true);
  stack.addEventListener("focusin", onFocusIn);
  stack.addEventListener("focusout", onFocusOut);
  window.addEventListener("resize", updateLayout);
  scrollTarget.addEventListener("scroll", scheduleDepth, { passive: true });
  updateLayout();

  return () => {
    observer?.disconnect();
    stack.removeEventListener("toggle", onToggle, true);
    stack.removeEventListener("focusin", onFocusIn);
    stack.removeEventListener("focusout", onFocusOut);
    window.removeEventListener("resize", updateLayout);
    scrollTarget.removeEventListener("scroll", scheduleDepth);
    window.cancelAnimationFrame(scrollFrame);
    window.cancelAnimationFrame(focusFrame);
    stack.removeAttribute("data-stacked");
    stack.style.removeProperty("--cyber-stack-end-space");
    cards.forEach(card => {
      card.style.removeProperty("--cyber-card-scale");
      card.style.removeProperty("--cyber-card-top");
    });
  };
}
