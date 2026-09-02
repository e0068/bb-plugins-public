# @bb-plugins/link-navigation

Shared layer for link resolution and navigating them. Two tiers.

## resolve.ts — pure resolution

Zero imports: neither `react` nor `node:path`. Works for both the server
(walking a file's body) and the front end (the editor's `linkResolver` on
every link). Exports:

- `isInTabLink(href)` — whether the link is local (not http/https/mailto/`//`/`#…`/empty).
- `parseHref(href)` — strips the title (` "..."`) first, then the anchor `#...`.
- `resolveRelative(fromPath, ref)` — resolves ref against the directory of
  `fromPath` into an absolute normalized path; the trailing slash is deduplicated.
- `fileRefFromCode(text)` — inline code like `references/x.md` as a file link.

The front end does NOT strip trailing punctuation (href is already bounded by
markup brackets) — the server strips it itself when parsing raw text, before calling this layer.

## jump-stack.ts — a pure jump stack

Immutable helpers over `{ stack: string[] }` (current is the last element):
`initStack`, `jumpTo`, `goBack`, `current`, `canGoBack`.

## nav.tsx — navigation (react is external)

- `useJumpStack(first)` — a hook on top of jump-stack.ts.
- `makeLinkResolver(opts)` — builds a `linkResolver` for md-editor from
  `isInTabLink` + `parseHref` + `resolveRelative`.

## Why it's built this way

See [memory/decisions/link-resolve-shared-layer.md](../../memory/decisions/link-resolve-shared-layer.md) —
why path resolution is pulled into a separate layer without `node:path`, and
what has to stay consistent between the server and the front end.
