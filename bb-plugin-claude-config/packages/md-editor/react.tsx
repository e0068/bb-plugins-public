// React wrapper around the vanilla md-editor engine (./md-editor.js). The
// vanilla editor owns the
// contenteditable surface, format bar, tables, and its own markdown
// round-trip; this wrapper only bridges it into React's value/onChange world
// and the host's `--mde-*` theme variables (see ./theme.css).
//
// Mount is imperative (`new VanillaMarkdownEditor(host, opts)` in
// useEffect) and torn down with `.destroy()` on unmount/editable-change —
// the vanilla editor is not a React component and manages its own DOM
// inside `host` entirely (it appends its own `.mde-root` as a CHILD of
// `host`, it does not take over `host` itself).
import { useEffect, useRef } from "react";

import { VanillaMarkdownEditor } from "./vanilla";
import type { MarkdownEditorInstance } from "./vanilla";
import "./md-editor.css";
// Theme: maps --mde-* onto host tokens. MUST be a selector that targets the
// `.mde-root` element md-editor mounts as a CHILD of `host` — NOT the host
// div itself, since md-editor.css declares every --mde-* var directly on
// `.mde-root` with its own hardcoded defaults, and a var set on a
// descendant always wins over one set on an ancestor regardless of the
// ancestor rule's specificity. See ./theme.css for the full mapping.
import "./theme.css";

export interface MarkdownEditorProps {
  value: string;
  onChange?: (v: string) => void;
  /** default true */
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
  /**
   * Убирает боковые «format margins» md-editor (md-editor.css, `padding: 4px
   * 44px`) — в узкой колонке эти поля съедают ширину под текст. У md-editor
   * нет опции для этого padding, поэтому вешаем класс на host, а правило
   * живёт в ./theme.css. Default false.
   */
  flush?: boolean;
  className?: string;
  /** Базовый класс host-элемента. Default "bb-mde-host". */
  hostClassName?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  editable = true,
  linkResolver,
  atLinks = false,
  pathProvider,
  onSave,
  flush = false,
  className,
  hostClassName,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditorInstance | null>(null);
  // Tracks the most recent value the editor itself emitted, so the
  // value-sync effect below can tell "the host set a genuinely new value"
  // apart from "this is just our own onChange echoing back through the
  // consumer's state" — the latter must NOT call setValue, or every
  // keystroke would reset the editor's DOM and caret.
  const lastEmittedRef = useRef(value);

  const onChangeRef = useRef(onChange);
  const linkResolverRef = useRef(linkResolver);
  const pathProviderRef = useRef(pathProvider);
  const onSaveRef = useRef(onSave);

  // Refresh the refs on every render so that stable proxies below (passed
  // once to the vanilla editor's constructor) always call the latest
  // callback identity — this lets e.g. `editable`-dependent navigation
  // update `linkResolver` WITHOUT tearing down and recreating the editor.
  useEffect(() => {
    onChangeRef.current = onChange;
    linkResolverRef.current = linkResolver;
    pathProviderRef.current = pathProvider;
    onSaveRef.current = onSave;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const editor = new VanillaMarkdownEditor(host, {
      value: lastEmittedRef.current,
      editable,
      atLinks,
      // This wrapper does not implement its own undo stack, so the
      // editor's internal ⌘Z/⌘Y binding is disabled rather than fighting a
      // host undo that doesn't exist here — the browser's native
      // contenteditable undo applies instead.
      history: false,
      onChange: (next) => {
        lastEmittedRef.current = next;
        onChangeRef.current?.(next);
      },
      linkResolver: (href) =>
        linkResolverRef.current ? linkResolverRef.current(href) : null,
      pathProvider: (query, mode) =>
        pathProviderRef.current ? pathProviderRef.current(query, mode) : [],
      onSave: (md) => onSaveRef.current?.(md),
    });
    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // Recreate when `editable` or `atLinks` changes — both are structural
    // rendering options the vanilla engine reads once in its constructor
    // (not through a live ref), so flipping either needs a fresh instance
    // to take effect. All other callbacks are read through the stable
    // proxies above via refs, so the editor is not recreated on every prop
    // change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, atLinks]);

  useEffect(() => {
    if (editorRef.current && value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      editorRef.current.setValue(value);
    }
  }, [value]);

  const hostClasses = [
    hostClassName || "bb-mde-host",
    flush ? "bb-mde-flush" : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");

  return <div ref={hostRef} className={hostClasses} />;
}
