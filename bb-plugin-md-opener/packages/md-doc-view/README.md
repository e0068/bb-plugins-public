# @bb-plugins/md-doc-view

Shared layer: the presentational experience of **MD Opener** (the
[Kasimov](https://github.com/e0068/Kasimov) editor) with inverted
dependencies. The `MdDocView` component owns the jump stack, edit mode, and
the CAS note, while effects arrive as function props — the consuming plugin
supplies its own RPC.

Used by two plugins: the `fileOpener` slot in
[bb-plugin-md-opener](../../bb-plugin-md-opener) and the embedded column in
[bb-plugin-claude-config](../../bb-plugin-claude-config) (`md-opener` opener
mode). One component — one experience, no code duplication and no detour
through the host tab
([decision](../../memory/decisions/claude-config-opener-setting.md)).

## Contract

```ts
interface MdDocViewProps {
  initialPath: string;
  load: (path) => Promise<LoadedDoc>;                       // {path, content, sha256, error?}
  save: (path, content, expectedSha256) => Promise<SaveResult>; // CAS
  resolveLinkTarget: (href, fromPath) => string | null;     // absolute in-tab target or null
}
```

Any file — markdown or not — is edited as raw text; there's no separate
"read-only" mode.

## Layers

- `KasimovEditor.tsx` — a React wrapper over `kasimov` (an internal detail of the package).
- `MdDocView.tsx` — the jump stack, editing, CAS; renders `KasimovEditor`.
- Link and path resolution is **injected** — the package doesn't depend on
  [link-navigation](../link-navigation); the consumer supplies it.

`kasimov` and `react` are peer dependencies: the consumer provides them (the
source import resolves from its `node_modules`).

## Tests

```
npm test
```

`KasimovEditor` is mocked in the tests (jsdom doesn't reproduce
contenteditable); loading, the jump stack, editing+CAS, conflicts, raw non-md,
and errors are all tested.
