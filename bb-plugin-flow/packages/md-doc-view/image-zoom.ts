// Layer 1 — where a click inside the document landed, as far as unfolding a
// picture is concerned. The listener sits on the whole document, not on each
// picture: the engine rebuilds its DOM on every keystroke and a listener on a
// single picture would not survive one. So the rule "was this a picture, and
// which one" is a pure function over the clicked node.

/** A picture worth unfolding: its address and the caption that goes under it. */
export interface ZoomTarget {
  readonly src: string;
  readonly alt: string;
}

/** The engine's raster picture. An SVG it inlines as `<svg>`, with no address of its own. */
export const ZOOM_SELECTOR = "img.mde-imgpic";

export function zoomTargetOf(node: EventTarget | null): ZoomTarget | null {
  if (!(node instanceof Element)) return null;
  const img = node.closest(ZOOM_SELECTOR);
  if (!(img instanceof HTMLImageElement)) return null;
  const src = img.getAttribute("src") ?? "";
  return src === "" ? null : { src, alt: img.getAttribute("alt") ?? "" };
}
