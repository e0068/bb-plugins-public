// Thin, consumer-side type shim for the vanilla md-editor engine
// (./md-editor.js). The
// engine is source-of-truth for its own API (see the comment block at its
// top) and stays plain, type-free ESM with no knowledge of any consumer —
// this file exists purely so package consumers get real types.
//
// An ambient `declare module "./md-editor.js" { ... }` looks like the
// natural fix, but TypeScript rejects relative specifiers in ambient module
// declarations (TS2436: "Ambient module declaration cannot specify relative
// module name"). So instead: import the untyped runtime value directly
// (suppressing the one resulting "no declaration file" error), and assert a
// hand-written type onto it.
// @ts-expect-error -- md-editor.js ships no declaration file; typed below.
import { MarkdownEditor as Impl } from "./md-editor.js";

export interface MarkdownEditorOptions {
  value?: string;
  onChange?: (v: string) => void;
  editable?: boolean;
  linkResolver?: (
    href: string,
  ) => { label?: string; onClick: () => void } | null;
  /** Opt-in: recognise a Claude-style `@path` import token as a link too. Default false. */
  atLinks?: boolean;
  pathProvider?: (
    query: string,
    mode: "path" | "import",
  ) => { path: string; label?: string; comment?: string }[];
  onSave?: (md: string) => Promise<void> | void;
  history?: boolean;
  onBeforeChange?: () => void;
}

export interface MarkdownEditorInstance {
  getValue(): string;
  setValue(v: string): void;
  focus(opts?: FocusOptions): void;
  destroy(): void;
}

export const VanillaMarkdownEditor = Impl as unknown as new (
  host: HTMLElement,
  opts?: MarkdownEditorOptions,
) => MarkdownEditorInstance;
