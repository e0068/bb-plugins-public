// Pure layer: pull links leading within the tab out of the .md body. Zero
// bb/node dependencies — reuses the shared path resolver
// (packages/link-navigation), the same one that drives the front end's
// linkResolver. Keep parsing here rather than duplicating it: the server and
// front end must agree on what counts as a link (see
// memory/decisions/link-resolve-shared-layer.md).
import {
  isInTabLink,
  parseHref,
} from "../packages/link-navigation/resolve";

// The only form the kasimov editor makes clickable is a markdown link
// `[text](target)` (target inside the parens). A Claude `@import` does NOT
// count: the kasimov engine doesn't render it as a link, and the server and
// front end must agree on what counts as a link (link-resolve-shared-layer,
// md-opener-kasimov-editor).
const MD_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

/**
 * Unique hrefs from the body that lead within the tab (local paths; not
 * http/mailto/anchor). Order matches the text; a duplicate of the same
 * spelling is collapsed. href is returned "as written in the markup" (with a
 * possible `#anchor`/title) — resolution and stripping the anchor is done by
 * the caller via parseHref, exactly as the front end does.
 */
export function extractLinkHrefs(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const href = raw.trim();
    if (!href || !isInTabLink(href)) return;
    // An empty path (`[x](#anchor)`) is not a file link.
    if (!parseHref(href).path) return;
    if (seen.has(href)) return;
    seen.add(href);
    out.push(href);
  };

  for (const m of body.matchAll(MD_LINK_RE)) push(m[1]);

  return out;
}
