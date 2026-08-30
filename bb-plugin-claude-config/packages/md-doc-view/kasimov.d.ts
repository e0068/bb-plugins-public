// Пакет kasimov — ESM vanilla JS без деклараций (github:e0068/Kasimov). Здесь
// его публичный вход `createEditor` (editor/create-editor.js) типизируется по
// README пакета и его тестам: фабрика редактора + управляющий объект. Держим
// только то, что реально зовёт обёртка KasimovEditor.tsx.
declare module "kasimov" {
  export interface KasimovLink {
    label?: string;
    onClick: () => void;
  }

  export interface KasimovOptions {
    value?: string;
    editable?: boolean;
    /** Клик по живой ссылке зовёт resolver.onClick вместо выделения токена. */
    followLinks?: boolean;
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
}

// dist/kasimov.css — структурный CSS редактора (side-effect import).
declare module "kasimov/css";
