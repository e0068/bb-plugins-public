// Layer 1 — the stylesheet that redraws two of the sidebar row glyphs. Zero
// effects: it only builds a CSS string; the content script injects it.
//
// Why CSS at all. `experimental_setThreadRowStatus` takes an icon NAME, not a
// drawing, and the host resolves that name against its own two registries —
// 47 eager plus 98 lazily loaded — falling back to a lightning bolt for
// anything else (see memory/decisions/row-status-rpc-not-frontend-hooks.md).
// Neither registry holds a commit glyph or a small dot, so "committed" could
// only ever ask for a branch icon and "uncommitted" for a full-size circle —
// which is what they still ask for here, as the fallback that renders if this
// stylesheet ever stops matching.
//
// The override itself is the host's own technique: bb draws plugin icons
// given by URL as `background-color: currentColor` under a `mask-image`, so
// the replacement inherits the tone colour exactly like a real icon does.
import { ICON, LABEL } from "./row-status";

export interface GlyphOverride {
  /** The host icon name the status asks for — also the fallback drawing. */
  icon: string;
  /** The status label; the host renders it as the glyph's `aria-label`. */
  label: string;
  /** The replacement drawing: a complete `<svg>` document. */
  svg: string;
}

// A filled dot, 8 of 24 units across — the size of bb's own native row dot
// (`size-[5px]` at a 16px icon), and a touch wider than the ring inside the
// commit glyph beside it.
const UNCOMMITTED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>';

// A commit on a vertical line: the ring in the middle, a stub of branch above
// and below. Stroke 1.5 with round caps is the host icon set's own weight
// (read off bb's registry), so it sits next to the native glyphs unnoticed.
const COMMITTED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round"><path d="M12 3.5v5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 15.5v5"/></svg>';

export const GLYPH_OVERRIDES: readonly GlyphOverride[] = [
  { icon: ICON.uncommitted, label: LABEL.uncommitted, svg: UNCOMMITTED_SVG },
  { icon: ICON.committed, label: LABEL.committed, svg: COMMITTED_SVG },
];

/**
 * An svg document as a `data:` URI safe to inline in a double-quoted CSS
 * `url()`. Percent-encoding everything is deliberate over hand-picking the
 * few dangerous characters: a quote or a `#` slipping through would end the
 * url() early and silently drop the rule.
 */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * The two rules each override needs: paint the replacement as a mask over
 * `currentColor`, and hide the host's own paths underneath it. Both mask
 * spellings are emitted — the host's own icon-by-url code ships the
 * `-webkit-` prefix too.
 */
function ruleFor({ icon, label, svg }: GlyphOverride): string {
  const target = `[data-sidebar-thread-trailing-indicator] [data-icon="${icon}"][aria-label="${label}"]`;
  const uri = `url("${svgDataUri(svg)}")`;
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
  return `${target}{${mask}}\n${target}>*{display:none}`;
}

/** The whole stylesheet; empty when there is nothing to override. */
export function glyphOverrideCss(overrides: readonly GlyphOverride[]): string {
  return overrides.map(ruleFor).join("\n");
}
