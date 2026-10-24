import { useLayoutEffect, useState, type RefObject } from "react";

/** The card's `@[45rem]` breakpoint — the same as the task rail's classes in index.tsx: below it the right-hand column leaves no room for the text. */
const NARROW_REM = 45;

/** Whether the card is narrower than its breakpoint — as on a phone — kept up to date as the card resizes. */
export function useNarrowCard(card: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = card.current;
    if (element === null) return;
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setNarrow(element.clientWidth < NARROW_REM * rem);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [card]);
  return narrow;
}
