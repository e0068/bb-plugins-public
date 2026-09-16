// Layer 1 — the editor engines' markup vocabulary. A bare string constant, no
// imports: both MdDocView and the plugins that render an engine directly need
// the same answer to "was this click on a link token?", and the answer belongs
// to neither of them.

/**
 * Link tokens in the engine's markup, for a consumer's click guard — every
 * token the engine renders as a link, INCLUDING one it won't follow (an
 * unresolvable target keeps `.mde-link` and gets `.mde-link-plain`).
 * A `[..](..)` link is `.mde-link`; a Claude `@import` is `.mde-atlink` and
 * carries NO `.mde-link` (packages/md-editor marks it with both classes,
 * Kasimov doesn't — it widened its own handler's selector instead). A guard
 * that checks only `.mde-link` lets a click the engine already turned into a
 * jump ALSO reach "click the text to edit" — see
 * memory/decisions/kasimov-atlink-click-guard.md.
 */
export const LINK_TOKEN_SELECTOR = ".mde-link, .mde-atlink";
