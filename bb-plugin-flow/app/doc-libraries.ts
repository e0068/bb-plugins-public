// Единственный файл Flow, что тянет CodeMirror и Radix Tabs для общего просмотрщика документов (packages/md-doc-view):
// пакеты под ../packages не импортируют их значениями — установка из git кладёт node_modules только в папку плагина.
// Здесь они резолвятся из dependencies Flow, и CodeMirror один на весь бандл. Тот же набор, что у MD Opener.
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
import type { DocLibraries } from "@bb-plugins/md-doc-view";

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
