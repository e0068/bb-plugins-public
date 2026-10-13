// Layer 1 — the third-party libraries a document is drawn with, as a type.
//
// The package imports neither CodeMirror nor Radix Tabs by value: a plugin
// installed from git has `node_modules` in its own folder only, and the
// bundler resolves a package from the importing file up. The plugin imports
// both in its own libraries.ts and hands one `DocLibraries` to MdDocView —
// one prop rather than two a consumer has to remember.
import type { CodeMirrorKit } from "../code-editor";
import type { TabsKit } from "../segmented-control";

export interface DocLibraries {
  /** Raw mode's editor — see packages/code-editor/codemirror-kit.ts. */
  readonly codeMirror: CodeMirrorKit;
  /** The header's mode switch — see packages/segmented-control. */
  readonly tabs: TabsKit;
}
