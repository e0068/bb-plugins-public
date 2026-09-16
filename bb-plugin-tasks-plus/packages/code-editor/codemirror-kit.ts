// Shared layer — the CodeMirror modules the editor is built from, as a type.
//
// The package never imports CodeMirror by value. A plugin installed from git
// gets `node_modules` in its own folder only, and the bundler resolves a
// package from the importing file up — so an import written here would look
// in `packages/code-editor/` and find nothing. The plugin imports these
// modules in its own `libraries.ts` and hands them down; this file only names
// their shape. `import type` is erased by the bundler and never resolved.
//
// One kit, one copy: every CodeMirror object the editor builds comes from the
// same copy of `@codemirror/state`, so the "multiple instances of
// @codemirror/state are loaded" boundary is never crossed.
import type ReactCodeMirror from "@uiw/react-codemirror";
import type { EditorView, keymap } from "@codemirror/view";
import type { StreamLanguage, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { javascript } from "@codemirror/lang-javascript";
import type { json } from "@codemirror/lang-json";
import type { css } from "@codemirror/lang-css";
import type { html } from "@codemirror/lang-html";
import type { markdown } from "@codemirror/lang-markdown";
import type { yaml } from "@codemirror/lang-yaml";
import type { shell } from "@codemirror/legacy-modes/mode/shell";
import type { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";

export interface CodeMirrorKit {
  readonly CodeMirror: typeof ReactCodeMirror;
  readonly EditorView: typeof EditorView;
  readonly keymap: typeof keymap;
  readonly StreamLanguage: typeof StreamLanguage;
  readonly defaultHighlightStyle: typeof defaultHighlightStyle;
  readonly syntaxHighlighting: typeof syntaxHighlighting;
  readonly oneDarkHighlightStyle: typeof oneDarkHighlightStyle;
  readonly javascript: typeof javascript;
  readonly json: typeof json;
  readonly css: typeof css;
  readonly html: typeof html;
  readonly markdown: typeof markdown;
  readonly yaml: typeof yaml;
  readonly shell: typeof shell;
}
