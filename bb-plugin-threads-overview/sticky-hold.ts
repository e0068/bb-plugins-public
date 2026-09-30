// Holding bb's composer in place on the card. bb sticks the thread's composer
// to the bottom of the conversation with `position: sticky`, and WebKit places
// a sticky box wrong inside a scaled ancestor: it measures the scroller at its
// scaled height, so the composer stands a share of the conversation's height
// above the bottom of the card, with messages showing under it. Chrome places
// it right. While the card is carried, the composer is taken out of sticky and
// held where `heldTop` says, again whenever the conversation under it moves;
// once the card lies flat again, it is stuck as bb drew it.
import { heldTop } from "./src/core/sticky-hold";

/** The composer on the carried card: `fit` brings it back to its floor, `release` sticks it again. */
export interface Hold {
  readonly fit: () => void;
  readonly release: () => void;
}

/** A box pulled out of sticky, what scrolls it, and the inline values it had before. */
interface Held {
  readonly box: HTMLElement;
  readonly scroller: HTMLElement;
  readonly gap: number;
  readonly position: string;
  readonly top: string;
}

/** The sticky boxes from `from` up to `within`, `within` left out. */
function stickyHolders(from: Element, within: Element): readonly HTMLElement[] {
  const holders: HTMLElement[] = [];
  for (let node = from.parentElement; node !== null && node !== within; node = node.parentElement) {
    if (getComputedStyle(node).position === "sticky") holders.push(node);
  }
  return holders;
}

/** What scrolls `box`: the nearest scroller above it, or `within` if none is. */
function scrollerOf(box: HTMLElement, within: HTMLElement): HTMLElement {
  for (let node = box.parentElement; node !== null && node !== within; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return node;
  }
  return within;
}

/** Screen px per own px of `node`: 1 when it has no size to measure by. */
function scaleOf(node: HTMLElement): number {
  return node.offsetHeight > 0 ? node.getBoundingClientRect().height / node.offsetHeight : 1;
}

/** Pin `box` by a relative offset where sticky has it now, minding how far above its floor it stands. */
function pin(box: HTMLElement, within: HTMLElement): Held {
  const scroller = scrollerOf(box, within);
  const stuck = box.getBoundingClientRect();
  const held = {
    box,
    scroller,
    gap: (scroller.getBoundingClientRect().bottom - stuck.bottom) / scaleOf(scroller),
    position: box.style.position,
    top: box.style.top,
  };
  box.style.position = "relative";
  box.style.top = "0px";
  box.style.top = `${stuck.top - box.getBoundingClientRect().top}px`;
  return held;
}

/** Stand `held.box` back on its floor, however the conversation has moved under it. */
function fit({ box, scroller, gap }: Held): void {
  const top = heldTop({
    top: Number.parseFloat(box.style.top) || 0,
    bottom: box.getBoundingClientRect().bottom,
    floor: scroller.getBoundingClientRect().bottom,
    gap,
    scale: scaleOf(scroller),
  });
  box.style.top = `${top}px`;
}

/**
 * Pin every sticky box between `from` and `within` where it stands now, keep
 * it there while its conversation scrolls or changes size, and return the
 * hold on them.
 */
export function holdSticky(from: Element, within: HTMLElement): Hold {
  const held = stickyHolders(from, within).map((box) => pin(box, within));
  const refit = () => held.forEach(fit);
  held.forEach(({ scroller }) => scroller.addEventListener("scroll", refit, { passive: true }));
  // A message growing or folding with no scroll and no finger moving: the
  // conversation's content changes size, and nothing else says so.
  const resized = typeof ResizeObserver === "function" ? new ResizeObserver(refit) : null;
  held.forEach(({ box, scroller }) => {
    resized?.observe(box);
    Array.from(scroller.children).forEach((child) => resized?.observe(child));
  });
  return {
    fit: refit,
    release: () => {
      resized?.disconnect();
      for (const { box, scroller, position, top } of held) {
        scroller.removeEventListener("scroll", refit);
        box.style.position = position;
        box.style.top = top;
      }
    },
  };
}
