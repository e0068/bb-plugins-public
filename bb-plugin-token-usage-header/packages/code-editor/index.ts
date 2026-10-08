// Public entry point: a code surface and the one rule for which grammar to
// read a file with. Extracted from bb-plugin-projects, whose node panel and
// file column drew it first — a second consumer (the Raw mode of
// packages/md-doc-view) is a reason to depend downward on one implementation
// rather than to copy it.
//
// CodeMirror is a peer dependency, not a dependency: the consuming plugin
// installs it into its own node_modules, imports it there and hands the
// modules down as a `CodeMirrorKit` (this monorepo's packages have no bundler
// of their own — a plugin imports the .tsx directly).
export { CodeEditor } from "./CodeEditor";
export type { CodeEditorProps } from "./CodeEditor";
export type { CodeMirrorKit } from "./codemirror-kit";
export { languageOf } from "./editor-language";
export type { EditorLanguage } from "./editor-language";
// Which palette the host paints in — exported because the editor is not the
// only thing that needs the answer (the graph and the diff viewer in Projects
// ask it too), and one answer beats three.
export { useHostColorMode } from "./use-host-color-mode";
export type { HostColorMode } from "./use-host-color-mode";
