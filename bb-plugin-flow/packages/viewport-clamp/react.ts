// A tooltip placed by the pointer, kept inside the window: its size is measured
// after it renders, and the position is clamped from that size before the
// browser paints.
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import { clampToViewport, type Point, type Size } from "./core";

export interface ViewportClamp<T extends HTMLElement, P extends Point | null = Point> {
  /** Goes on the tooltip element — its size is what gets clamped. */
  readonly ref: RefObject<T | null>;
  /** Top-left corner for the tooltip's `left`/`top`; null while `natural` is null. */
  readonly position: P;
}

const sameSize = (a: Size | null, b: Size): boolean => a !== null && a.width === b.width && a.height === b.height;

/**
 * `natural` is where the tooltip's top-left corner would go — the pointer plus
 * an offset. The size is re-measured after every render, because it changes
 * with the content, and stored only when it changes; the position is derived
 * from it in render, so a pointer move costs one render.
 */
export function useViewportClamp<T extends HTMLElement>(natural: Point): ViewportClamp<T>;
export function useViewportClamp<T extends HTMLElement>(natural: Point | null): ViewportClamp<T, Point | null>;
export function useViewportClamp<T extends HTMLElement>(natural: Point | null): ViewportClamp<T, Point | null> {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const { width, height } = element.getBoundingClientRect();
    setSize((current) => (sameSize(current, { width, height }) ? current : { width, height }));
  });

  // Before the first measurement the tooltip stands where the pointer put it.
  const position =
    natural === null || size === null
      ? natural
      : clampToViewport(natural, size, { width: window.innerWidth, height: window.innerHeight });
  return { ref, position };
}
