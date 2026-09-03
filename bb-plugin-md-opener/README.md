# bb-plugin-md-opener

`.md` opener for bb's right panel. Registers the `fileOpener` slot: the "Open
with" menu on a file tab gets a **Kasimov** entry that renders markdown with
the [Kasimov](https://github.com/e0068/Kasimov) editor instead of the
built-in preview.

## What it does

- **Markdown links inside the document are clickable.** `[text](tasks/x.md)`
  and absolute paths open **in the same tab**: its own jump stack, a breadcrumb
  with the file name, a "back" button. Clicking a link to a nonexistent file
  shows an error in the same tab. Clicking a link always follows it (the
  `followLinks` flag is on) — both in view mode and while editing; navigating
  away from edit mode discards the unsaved draft, which is an intentional
  navigation gesture.
- **Click-to-edit**, save with ⌘S with CAS protection (writes only if the file
  on disk hasn't changed since it was read; otherwise a message is shown and
  the edit isn't lost).

## Design (layers, dependencies strictly downward)

1. [packages/link-navigation](../packages/link-navigation) — pure path
   resolution and href parsing (shared with the server and the front end,
   without `node:path`).
2. [src/opener-links.ts](src/opener-links.ts) — extracting markdown links from
   the body.
3. [src/opener-source.ts](src/opener-source.ts) — resolving a
   `PluginFileOpenerSource` into a host and a confinement root
   (`workspace`/`thread-storage`/`host`).
4. [server.ts](server.ts) — the `readDoc` RPC (read plus link-liveness
   annotation in a single response) and `writeDoc` (CAS). `hostId` is threaded
   through everywhere — a thread's file may live on a different machine.
5. [packages/md-doc-view](../packages/md-doc-view) — the shared layer:
   rendering the MD Opener (jump stack, editing, CAS) with injected effects,
   plus the `KasimovEditor` wrapper around `createEditor` from
   [`kasimov`](https://github.com/e0068/Kasimov). The built-in
   [bb-plugin-claude-config](../bb-plugin-claude-config) column uses the same
   layer.
6. [app.tsx](app.tsx) — the thin slot: `load`/`save`/`resolveLinkTarget` over
   RPC, matching the `MdDocView` contract.

## Limitations

- The editor is the external `kasimov` package, not
  [packages/md-editor](../packages/md-editor)
  ([decision](../memory/decisions/md-opener-kasimov-editor.md)). The public
  `createEditor` only makes the markdown form `[text](href)` clickable —
  it doesn't render a Claude `@import` (`@AGENTS.md`) as a link, so that form
  isn't clickable here.
- Navigation always happens **within the tab** — opening a neighboring file
  tab isn't available to plugins (in the SDK, `openWorkspaceFile` is only
  available to `messageDirective`, see
  [decision](../memory/decisions/md-opener-jumps-inside-tab.md)).
- For `host` paths there's intentionally no "under `$HOME`" boundary — the
  file may live on a different machine
  ([decision](../memory/decisions/opener-host-path-no-home-fence.md)).

## Tests

```
npm test
```

Layers are covered separately: link parsing, source resolution, the server
(read/CAS/boundaries), and the slot component (jsdom, editor mocked).
