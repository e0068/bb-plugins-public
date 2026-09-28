// Test infrastructure — the kit a plugin would build in its libraries.ts,
// imported from this package's own devDependencies. Outside test-support/
// the package imports CodeMirror by type only (git-install.test.ts).
import { type ComponentProps } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { StreamLanguage, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { CodeEditor as KitCodeEditor } from "../CodeEditor";
import type { CodeMirrorKit } from "../codemirror-kit";

export const testCodeMirrorKit: CodeMirrorKit = {
  CodeMirror,
  EditorView,
  keymap,
  StreamLanguage,
  defaultHighlightStyle,
  syntaxHighlighting,
  oneDarkHighlightStyle,
  javascript,
  json,
  css,
  html,
  markdown,
  yaml,
  shell,
};

/** The editor with the test kit already in hand — tests speak about behaviour, not wiring. */
export function CodeEditor(props: Omit<ComponentProps<typeof KitCodeEditor>, "kit">) {
  return <KitCodeEditor kit={testCodeMirrorKit} {...props} />;
}
