// The rows of a queue drawn as far as the screen reaches — see `drawnRows`.
// The end of the drawn rows carries a marker; once it comes within half a
// screen of sight, the next batch is drawn, and the marker is watched afresh
// from where it then stands. A browser without IntersectionObserver draws the
// whole list.
import { useEffect, useState, type ReactNode } from "react";

import { drawnRows } from "./src/core/drawn-rows";

/** How far past the edge of sight the end of the drawn rows counts as in reach. */
const REACH = "50% 0px";

const scrollsDown = (element: Element): boolean =>
  element.scrollHeight > element.clientHeight && /(auto|scroll|overlay)/.test(getComputedStyle(element).overflowY);

/**
 * The nearest box that scrolls the list up and down, or none for the page
 * itself. The track of the project slides scrolls sideways only and is passed
 * by: rooted there, the reach would never get past the page's own edge.
 */
function verticalScroller(element: Element): Element | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) if (scrollsDown(node)) return node;
  return null;
}

/** `items` as rows of the list they stand in, as many as the screen reaches. */
export function RowsNearView<Item>({ items, render }: { items: readonly Item[]; render: (item: Item) => ReactNode }) {
  const watchable = typeof IntersectionObserver === "function";
  const [reaches, setReaches] = useState(0);
  const [end, setEnd] = useState<Element | null>(null);
  const shown = watchable ? drawnRows(items.length, reaches) : items.length;

  // Watched afresh after every batch: a marker still in reach reports no change by itself.
  useEffect(() => {
    if (end === null) return;
    const observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && setReaches((count) => count + 1),
      { root: verticalScroller(end), rootMargin: REACH },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [end, shown]);

  return (
    <>
      {items.slice(0, shown).map(render)}
      {shown < items.length && <li ref={setEnd} aria-hidden="true" className="h-px border-0" />}
    </>
  );
}
