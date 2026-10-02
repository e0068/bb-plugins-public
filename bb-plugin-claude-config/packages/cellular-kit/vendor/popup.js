// kit/popup.js — position a popover (picker palette, dropdown menu) clamped to the viewport.
// Ported from public/cellular-host.js:88-96. DOM-only (reads offset sizes, writes left/top) — its
// correctness lives in the browser gate, not Node.

// Place `el` at (left, below); if it would overflow the bottom, flip above the anchor (`above`),
// then clamp into the viewport with a 4px margin on every side.
export function placePopup(el, left, below, above) {
  var vw = window.innerWidth || 1280, vh = window.innerHeight || 900;
  var mw = el.offsetWidth, mh = el.offsetHeight;
  el.style.left = Math.max(4, Math.min(left, vw - mw - 4)) + "px";
  var top = below;
  if (top + mh > vh - 4) top = (above != null ? above : below) - mh - 4;
  if (top < 4) top = Math.max(4, Math.min(below, vh - mh - 4));
  el.style.top = top + "px";
}
