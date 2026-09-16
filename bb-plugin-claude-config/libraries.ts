// The one file in this plugin that imports CodeMirror and Radix Tabs for the
// shared document view. The packages under ../packages import neither by
// value: a plugin installed from git gets `node_modules` in its own folder
// only, and the bundler resolves a package from the importing file up — an
// import written there would find nothing. Written here, it resolves from this
// plugin's `dependencies`, and every CodeMirror object comes from one copy.
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
import { List, Root, Trigger } from "@radix-ui/react-tabs";
import type { DocLibraries } from "./packages/md-doc-view";

export const docLibraries: DocLibraries = {
  codeMirror: {
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
  },
  tabs: { Root, List, Trigger },
};
