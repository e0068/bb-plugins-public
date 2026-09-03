// Types for the vendored kasimov.js build. The package is ESM vanilla JS
// with no declarations of its own (github:e0068/Kasimov). The public entry
// point `createEditor` (editor/create-editor.js) is typed from the package's
// README and its tests: an editor factory + a control object. We only keep
// what the wrapper packages/md-doc-view/KasimovEditor.tsx actually calls.

export interface KasimovLink {
  label?: string;
  onClick: () => void;
}

export interface KasimovOptions {
  value?: string;
  editable?: boolean;
  /** Clicking a live link calls resolver.onClick instead of selecting the token. */
  followLinks?: boolean;
  /** `@path` (Claude @import) is clickable (default true); false — plain text. */
  atLinks?: boolean;
  /** Show the frontmatter block as a grid (default true); false — hide it, the value is preserved. */
  frontmatter?: boolean;
  /** Mermaid node style: "contrast" — a filled chip with inverse text; anything else/empty — "soft" nodes (default). */
  mermaidNodes?: "soft" | "contrast";
  linkResolver?: (href: string) => KasimovLink | null;
  pathProvider?: (
    query: string,
    mode: "path" | "import",
  ) => { path: string; label?: string; comment?: string }[];
  onSave?: (markdown: string) => Promise<void> | void;
  onChange?: (markdown: string) => void;
}

export interface KasimovEditorInstance {
  getValue(): string;
  setValue(value: string): void;
  focus(opts?: FocusOptions): void;
  undo(): boolean;
  destroy(): void;
}

export function createEditor(
  hostEl: HTMLElement,
  opts?: KasimovOptions,
): KasimovEditorInstance;
