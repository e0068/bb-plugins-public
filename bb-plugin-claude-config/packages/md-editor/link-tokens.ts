// Layer 1 — pure. The engine's markup vocabulary for "this is a link": a
// `[..](..)` link is `.mdb-link`, a Claude `@import` is `.mdb-atlink` (marked
// with both). A consumer that handles clicks around the editor leaves these to
// the editor's own linkResolver.
//
// The prefix is `mdb-`, not Kasimov's `mde-`: the two engines are bundled side
// by side in Claude Config, and every shared class name let one engine's CSS
// paint the other — Kasimov's document came out on this engine's #0e0e0e.
export const LINK_TOKEN_SELECTOR = ".mdb-link, .mdb-atlink";
