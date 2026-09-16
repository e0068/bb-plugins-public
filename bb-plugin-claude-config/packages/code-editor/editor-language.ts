// Layer 1 — pure. Which grammar a code editor should read a file with, from
// nothing but the file's name.
//
// The extension is the whole answer on purpose: sniffing content would need
// the text before the editor can even be chosen, and the one case an
// extension gets wrong — a shell script with no suffix — is shown as plain
// text, which is what it was before there was an editor at all.

export type EditorLanguage =
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "json"
  | "css"
  | "html"
  | "markdown"
  | "yaml"
  | "shell";

/** Extension (lower-case, no dot) → language. The one table the editor's grammar list is built from. */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, EditorLanguage>> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  json: "json",
  jsonc: "json",
  css: "css",
  html: "html",
  htm: "html",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  yaml: "yaml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
};

/** The language a file is written in, by its extension; `null` when the name says nothing this knows. */
export function languageOf(path: string): EditorLanguage | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  // `.gitignore` has no extension: the dot is its first character.
  if (dot <= 0) return null;
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}
