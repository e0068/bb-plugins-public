// Layer 1 — the stylesheet that, while a PR/Merge/Archive operation runs, masks
// the host's own "waiting for input" question mark with this plugin's blinking
// operation glyph. Zero effects: it only builds a CSS string; the content
// script injects it once and toggles the marker attribute per row.
//
// Why a mask and not a status push. The sidebar row has a single trailing-
// indicator slot, and the host hard-codes three of its own indicator kinds to
// win it over any plugin status — `runtime`, `unread-error` and
// `waiting-for-input` (bb bundle, the `LY` oracle). While a thread is
// `waiting-for-input` the host draws its question mark (an Icon named
// `CircleQuestion`) and our status glyph is never even rendered, so there is no
// node of ours to restyle. The only lever left to a full-trust content script
// is to mask the host's own node — the exact `mask-image over currentColor`
// technique already used for the two pre-PR glyphs in row-glyph-css.ts.
//
// The override is scoped by an attribute the content script sets on the busy
// row's container (see BUSY_OVERRIDE_ATTR): a plain CSS selector cannot express
// "this specific thread has a live operation", and the row's own
// `data-sidebar-thread-id` sits on an absolutely-positioned overlay link that
// is not an ancestor of the indicator, so it can't anchor the selector either.
import { svgDataUri } from "./row-glyph-css";

/** The attribute the content script sets on a row whose PR/Merge/Archive op is live. */
export const BUSY_OVERRIDE_ATTR = "data-pr-op-busy";

/**
 * The host icon name for its "waiting for input" question mark — bb bundle: the
 * `waiting-for-input` indicator kind renders an Icon named `CircleQuestion`.
 */
export const HOST_QUESTION_ICON = "CircleQuestion";

/** The blink keyframes name, namespaced so it can never collide with the host's. */
export const BLINK_ANIMATION = "bb-pr-op-blink";

// A git-merge glyph (lucide's own paths): two nodes and a branch merging in.
// It reads as "this branch is being landed right now" — the one thing all three
// operations (open PR, merge, archive-after-merge) have in common — and is
// unmistakable next to the question mark it replaces. Stroke 1.5 with round
// caps matches the host icon set's weight, like COMMITTED_SVG.
const OP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v3a9 9 0 0 0 9 9"/></svg>';

/**
 * The whole stylesheet: mask the question mark with the operation glyph, hide
 * the host's own path underneath, and pulse it (only where motion is welcome).
 * A fixed string — the per-row scoping is the marker attribute, not the CSS.
 */
export function busyOverrideCss(): string {
  const target = `[${BUSY_OVERRIDE_ATTR}] [data-sidebar-thread-trailing-indicator] [data-icon="${HOST_QUESTION_ICON}"]`;
  const uri = `url("${svgDataUri(OP_SVG)}")`;
  const mask = [
    `background-color:currentColor`,
    `-webkit-mask-image:${uri}`,
    `mask-image:${uri}`,
    `-webkit-mask-position:center`,
    `mask-position:center`,
    `-webkit-mask-repeat:no-repeat`,
    `mask-repeat:no-repeat`,
    `-webkit-mask-size:contain`,
    `mask-size:contain`,
  ].join(";");
  return [
    `@keyframes ${BLINK_ANIMATION}{0%,100%{opacity:1}50%{opacity:0.35}}`,
    `${target}{${mask}}`,
    `${target}>*{display:none}`,
    `@media (prefers-reduced-motion:no-preference){${target}{animation:${BLINK_ANIMATION} 1.2s ease-in-out infinite}}`,
  ].join("\n");
}
