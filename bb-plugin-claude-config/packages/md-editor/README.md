# @bb-plugins/md-editor

Shared package: a vanilla WYSIWYG markdown editor (`md-editor.js`,
`markdown.js`, `tables.js`, `history.js`, `md-editor.css`) plus a React
wrapper and a theme built on `--mdb-*` variables.

A single contenteditable surface; markdown is the single source of truth.
There's no separate documentation of the engine's internals here — read the
source in this directory.

## Class prefix `mdb-`

Every class and variable the engine owns starts with `mdb-`, and `LINK_TOKEN_SELECTOR` (`link-tokens.ts`) names its link tokens. The prefix is deliberately not Kasimov's `mde-`: Claude Config bundles both engines, and bb applies a plugin's CSS beyond its own page, so a shared class let one engine's CSS paint the other — the `.mde-root { background: #0e0e0e }` of this engine turned Kasimov's documents black in Claude Config and in the MD Opener panel next to it. A click guard around this editor uses this package's `LINK_TOKEN_SELECTOR`, never the one from `packages/md-doc-view`.

## Import

```ts
import { MarkdownEditor } from "../../packages/md-editor";
// or, if the package is installed via a workspace: "@bb-plugins/md-editor"
```

`react` and `react-dom` are peerDependencies: in a `bb plugin build` build
they're externals (host globals), so a second React instance never appears.

## `MarkdownEditor` props

| Prop            | Type                                                                             | Default   | Description                                                                 |
| ---------------- | -------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------- |
| `value`           | `string`                                                                          | —              | markdown text (controlled)                                                |
| `onChange`        | `(v: string) => void`                                                            | —              | called when the content changes                                       |
| `editable`        | `boolean`                                                                         | `true`         | changing this value recreates the editor instance                               |
| `linkResolver`    | `(href: string) => { label?: string; onClick: () => void } \| null`             | —              | makes a link interactive; `null` — the link stays plain text      |
| `pathProvider`    | `(query: string, mode: "path" \| "import") => { path; label?; comment? }[]`     | —              | path autocomplete in the editor                                              |
| `onSave`          | `(md: string) => Promise<void> \| void`                                          | —              | a save hook (e.g. ⌘S inside the editor)                             |
| `flush`           | `boolean`                                                                         | `false`        | removes the side format margins (44px → 12px), for narrow columns            |
| `className`       | `string`                                                                          | —              | extra class on the host element                                         |
| `hostClassName`   | `string`                                                                          | `"bb-mdb-host"`| base class of the host element; the theme (`theme.css`) targets `.bb-mdb-host .mdb-root` |

Callbacks (`onChange`, `linkResolver`, `pathProvider`, `onSave`) can change
between renders without recreating the editor — they're read through stable
proxy wrappers. The editor is only recreated when `editable` changes.

## Vanilla usage

```ts
import { VanillaMarkdownEditor } from "../../packages/md-editor";

const editor = new VanillaMarkdownEditor(hostEl, {
  value: "# hi",
  onChange: (v) => console.log(v),
});
```
