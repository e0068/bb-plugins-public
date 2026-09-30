// Types for the vendored kasimov.js build. The package is ESM vanilla JS
// with no declarations of its own (github:e0068/Kasimov). The public entry
// point `createEditor` (editor/create-editor.js) is typed from the package's
// README and its tests: an editor factory + a control object. We only keep
// what the wrapper packages/md-doc-view/KasimovEditor.tsx actually calls.

export interface KasimovLink {
  label?: string;
  onClick: () => void;
}

/**
 * A picture's size cap, as the engine models it (editor/md-editor/image.js).
 * It lives in the markdown itself, in the tail after `|` inside the alt text:
 * `![caption|600x400ch](src)` — width, `WxH` or `xH`, then `c`/`r` for the
 * alignment, then `h` to hide the caption, all glued with no separators. A
 * space anywhere in the tail voids it: the text stays part of the caption.
 */
export type KasimovMax =
  | { readonly tag: "none" }
  | { readonly tag: "w"; readonly w: number }
  | { readonly tag: "h"; readonly h: number }
  | { readonly tag: "wh"; readonly w: number; readonly h: number };

export type KasimovAlign = { readonly tag: "left" | "center" | "right" };

/** A picture as the engine parsed it out of one `![…](…)`. */
export interface KasimovImage {
  /** The caption: the engine draws it under a block picture unless hidden. */
  readonly alt: string;
  readonly src: string;
  readonly max: KasimovMax;
  readonly align: KasimovAlign;
  readonly hideCaption: boolean;
}

/**
 * What the menu may do to the picture it was opened on. Each call rewrites that
 * one line of markdown and rebuilds the document; `alt` and `src` are not among
 * them — the engine carries those over from the current value.
 */
export interface KasimovImageActions {
  /** 0 clears the width cap. */
  setWidth(w: number): void;
  /** 0 clears the height cap. */
  setHeight(h: number): void;
  setAlign(align: KasimovAlign): void;
  setHideCaption(hide: boolean): void;
  remove(): void;
}

export const alignLeft: KasimovAlign;
export const alignCenter: KasimovAlign;
export const alignRight: KasimovAlign;

export const maxNone: KasimovMax;
export function maxW(w: number): KasimovMax;
export function maxH(h: number): KasimovMax;
export function maxWH(w: number, h: number): KasimovMax;
/** The same cap with its width set; 0 clears it, the height is kept. */
export function withMaxWidth(max: KasimovMax, w: number): KasimovMax;
/** The same cap with its height set; 0 clears it, the width is kept. */
export function withMaxHeight(max: KasimovMax, h: number): KasimovMax;

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
  /**
   * Draw the picture's settings menu. The engine draws no menu of its own: it
   * creates the "⋯" button over a block picture only when this is given, and
   * only in edit mode, then calls it with the button to anchor to. Absent — the
   * button is never created and the picture cannot be settled from the UI.
   */
  imageMenu?: (
    anchor: HTMLElement,
    image: KasimovImage,
    actions: KasimovImageActions,
  ) => void;
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
