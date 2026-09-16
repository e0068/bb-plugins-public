# @bb-plugins/md-doc-view

Shared layer: the presentational experience of **MD Opener** (the
[Kasimov](https://github.com/e0068/Kasimov) editor) with inverted
dependencies. The `MdDocView` component owns the jump stack, the mode, the
draft and the CAS note, while effects arrive as function props — the consuming
plugin supplies its own RPC.

A document has three modes and one draft. **Read** is the rendered document,
**Write** is Kasimov editing it in place, **Raw** is its markdown source in a
code editor with highlighting and line numbers. The three are three views of
the same text: an edit made in Raw is what Read shows, and Save writes
whichever of them was typed into. The header carries the switcher and a reload
control, and gains a second row — `+N −M`, Save, Cancel — for exactly as long
as the draft differs from the file.

With `guardDraft` the unsaved draft also holds the rest of the app: everything
on screen outside the view is shaded, and a click on the shade opens a dialog
with the draft's diff against the file, Discard Changes and Save Changes.
Escape or a click beside the dialog closes the dialog alone — the shade belongs
to the draft, not to the dialog. Save Changes goes through the same CAS save as
the header's Save, so a conflict keeps the draft, the shade and the note. Only
the MD Opener tab turns it on: it owns its surface, while the Cloud Config
column and the Projects panel sit among the host's own controls.

Used by two plugins: the `fileOpener` slot in
[bb-plugin-md-opener](../../bb-plugin-md-opener) and the embedded column in
[bb-plugin-claude-config](../../bb-plugin-claude-config) (`md-opener` opener
mode). One component — one experience, no code duplication and no detour
through the host tab
([decision](../../memory/decisions/claude-config-opener-setting.md)).

## Contract

```ts
interface MdDocViewProps {
  libraries: DocLibraries;                                  // {codeMirror, tabs} imported by the plugin
  initialPath: string;
  load: (path) => Promise<LoadedDoc>;                       // {path, content, sha256, error?}
  save: (path, content, expectedSha256) => Promise<SaveResult>; // CAS
  resolveLinkTarget: (href, fromPath) => string | null;     // absolute in-tab target or null
}
```

Any file — markdown or not — is edited as raw text; there's no separate
"read-only" mode *for a file*. `readOnly` is about the other case: a document
the consumer **assembled** rather than read — a node passport, a generated
report — which has no path a save could land on. It leaves the switcher with a
single Read segment and refuses `startInEdit`, and leaves link jumps alone. Like
`startInEdit`, it describes the tab and not one document: a file reached by a
link out of the assembled one is read-only as well.

Optional props carry the look and the flags; `startInEdit`
makes every document the tab shows — the first one and the target of a jump —
arrive in Write instead of Read (an unreadable one stays an error).
`initialLine` is the exception that proves the rule: it describes ONE document,
the first, and opens it in Raw on that line — a line number is an address in
the source, and a jump away from that document drops it. Consumers derive the whole set from the settings table with
`toFlags` and spread it, so a new field needs no pass-through of its own
([decision](../../memory/decisions/doc-start-in-edit-setting.md)).

## Layers

- `doc-mode.ts`, `line-diff.ts`, `shade-rects.ts` — pure, zero imports: which
  modes a document offers and which it opens in, how far the draft has drifted
  in lines, and the four boxes that shade the viewport around the view.
- `libraries.ts` — types only: the CodeMirror kit and Radix Tabs a plugin
  hands down as one `DocLibraries`.
- `DocHeader.tsx` — the header as a view with no state: everything it shows
  arrives as a prop, so all three surfaces get the same one by construction.
- `DraftGuard.tsx` — the shade and the Unsaved changes dialog. It imports a
  Radix dialog and `@pierre/diffs` by value, which is allowed because the host
  shims both; a plugin rendering `MdDocView` in tests adds `mdDocViewDedupe`
  from [plugin-base](../plugin-base/vitest-react-dedupe.ts) so both resolve
  from its own root.
- `KasimovEditor.tsx` — a React wrapper over `kasimov` (an internal detail of the package).
- `MdDocView.tsx` — the jump stack, the mode, the draft, CAS; renders
  `DocHeader` over either `KasimovEditor` (Read, Write) or `CodeEditor` (Raw).
- Link and path resolution is **injected** — the package doesn't depend on
  [link-navigation](../link-navigation); the consumer supplies it.

`kasimov` and `react` are peer dependencies: the consumer provides them (the
source import resolves from its `node_modules`).

CodeMirror and Radix Tabs are imported by the consuming plugin, not by this
package or by [code-editor](../code-editor) and
[segmented-control](../segmented-control). A plugin installed from git gets
`node_modules` in its own folder only, and esbuild resolves a package from the
importing FILE up — an import written anywhere under `packages/` would find
nothing and fail the build with "Could not resolve". So each plugin that shows a
document keeps one `libraries.ts`, declares `@uiw/react-codemirror`,
`@codemirror/*` and `@radix-ui/react-tabs` in its own `dependencies`, and passes
the result as `libraries`. `git-install.test.ts` holds this package, like the
two below it, to value imports of what the host shims only.

## Tests

```
npm test
```

Tests render `MdDocView` from `test-support/libraries.tsx`, which fills
`libraries` with the test kits of code-editor and segmented-control.
`KasimovEditor` and `CodeEditor` are mocked (jsdom reproduces neither
contenteditable nor CodeMirror); loading, the jump stack, the three modes and
the shared draft, the second row, CAS and conflicts, reload, `initialLine`, the
draft guard and errors are all tested; the diff viewer is mocked, and the
shade's geometry has property tests of its own in `shade-rects.test.ts`. `atimport-click.test.tsx` runs against the REAL engine:
what it pins is the engine's own markup, which no mock can vouch for.
