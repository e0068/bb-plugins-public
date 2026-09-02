/// <reference path="./kasimov.d.ts" />
// React wrapper around the vendored Kasimov editor (createEditor,
// editor/create-editor.js). The engine is vendored as a sibling layer,
// packages/kasimov (a ready-made build); the wrapper pulls it in via a
// relative import: the bare specifier "kasimov" from this package doesn't
// resolve through the plugin's bundler — the dependency is installed into
// the sibling plugin's node_modules, not the ancestor's (see
// memory/decisions/md-opener-vendor-kasimov.md).
// Kasimov ships as vanilla ESM: the factory mounts its own contenteditable
// into the host element and owns the DOM entirely; the wrapper just bridges it
// into React's value/onChange world and keeps the instance identity stable
// across renders.
//
// The slash-reference above pulls in the ambient declaration for the css
// module's side-effect import; the engine's types come from
// packages/kasimov/kasimov.d.ts via a relative import.
//
// Difference from packages/md-editor/react: there the engine is a class, `new
// VanillaMarkdownEditor(host, opts)`; here Kasimov provides a factory,
// `createEditor(host, opts)`. As of 3eb7ba5 the engine also knows about
// Claude `@import` (the `atLinks` flag) and mermaid node style
// (`mermaidNodes`) — both are threaded through as props (see
// memory/decisions/md-opener-kasimov-editor.md).
import { useEffect, useId, useRef } from "react";
import { createEditor } from "../kasimov/kasimov.js";
import type { KasimovEditorInstance, KasimovLink } from "../kasimov/kasimov.js";
import "../kasimov/kasimov.css";
import { kasimovCssRule } from "./kasimov-settings";

export interface KasimovEditorProps {
  value: string;
  onChange?: (v: string) => void;
  /** default true */
  editable?: boolean;
  /** Clicking a live link follows it. default true. */
  followLinks?: boolean;
  /** `@path` (Claude @import) is clickable. default true. */
  atLinks?: boolean;
  /** Show the frontmatter block as a grid. default true. */
  frontmatter?: boolean;
  /** Mermaid node style: "contrast" — filled chip; "soft" — soft (default). */
  mermaidNodes?: "soft" | "contrast";
  /** CSS custom properties (`--kasi-*` etc.); applied to `.mde-root` inside the host. */
  vars?: Record<string, string>;
  linkResolver?: (href: string) => KasimovLink | null;
  onSave?: (md: string) => Promise<void> | void;
  className?: string;
}

export function KasimovEditor({
  value,
  onChange,
  editable = true,
  followLinks = true,
  atLinks = true,
  frontmatter = true,
  mermaidNodes = "soft",
  vars,
  linkResolver,
  onSave,
  className,
}: KasimovEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<KasimovEditorInstance | null>(null);
  // ID selector for the skin rule (see the vars effect below). React 18 returns
  // useId() with colons ("`:r0:`"), which are invalid in raw CSS/HTML ids
  // without escaping — strip them; React 19 (current here) returns "_r0_"
  // without colons, so .replace is a no-op, but the peer range also allows 18.
  const hostId = "kasi-host-" + useId().replace(/:/g, "");
  // The last value EMITTED by the editor itself: the value-sync effect below
  // uses this to distinguish "the host set a new value" from "our onChange
  // echoed back through the consumer's state" — the latter must NOT call
  // setValue, or every keystroke would reset the DOM and the caret.
  const lastEmittedRef = useRef(value);

  const onChangeRef = useRef(onChange);
  const linkResolverRef = useRef(linkResolver);
  const onSaveRef = useRef(onSave);

  // Update the refs on every render so the stable proxies (passed into the
  // factory once) always call the latest callback identity — this lets
  // linkResolver change without recreating the editor.
  useEffect(() => {
    onChangeRef.current = onChange;
    linkResolverRef.current = linkResolver;
    onSaveRef.current = onSave;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const editor = createEditor(host, {
      value: lastEmittedRef.current,
      editable,
      // Clicking a link follows it instead of selecting the token. Enabled by
      // default (md-opener-kasimov-editor.md); in edit mode, following a link
      // navigates away from an unsaved draft DELIBERATELY. Now controlled by a setting.
      followLinks,
      atLinks,
      frontmatter,
      mermaidNodes,
      onChange: (next) => {
        lastEmittedRef.current = next;
        onChangeRef.current?.(next);
      },
      linkResolver: (href) =>
        linkResolverRef.current ? linkResolverRef.current(href) : null,
      onSave: (md) => onSaveRef.current?.(md),
    });
    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // Recreated when `editable`/`followLinks`/`atLinks`/`frontmatter`/
    // `mermaidNodes` change: Kasimov reads them once in createEditor (not via a
    // live ref), so toggling them requires a fresh instance. The other
    // callbacks go through refs — the editor isn't recreated when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, followLinks, atLinks, frontmatter, mermaidNodes]);

  useEffect(() => {
    if (editorRef.current && value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      editorRef.current.setValue(value);
    }
  }, [value]);

  // CSS custom properties (`--kasi-*`) can't be hung on the host via an inline
  // style: the engine redeclares its own --kasi-* set on every .mde-root,
  // which it recreates on every _render() (i.e. on every keystroke) — see
  // editor/md-editor/md-editor.js upstream. A value declared on the element
  // itself always wins over one inherited from an ancestor regardless of
  // specificity (the contract is documented upstream in
  // memory/wiki/kasi-css-contract.md), so host.style.setProperty is
  // immediately overridden by the local default of the same name on
  // .mde-root. The correct point of application is a CSS rule with higher
  // specificity targeting `.mde-root` (upstream example:
  // examples/kasi-connector.example.css) — kept in document.head under an ID
  // selector keyed to the host, so it survives any .mde-root rebuild because
  // it matches by selector, not by node identity.
  //
  // Building the rule's text itself is a pure function (kasimovCssRule), not
  // part of the effect: this makes the effect depend on the finished string
  // rather than on the `vars` object, which consumers recreate on every
  // render (otherwise a re-render with content-equal but reference-new `vars`
  // would tear down and recreate the tag without any actual change to the
  // resulting CSS).
  const cssRule = kasimovCssRule(hostId, vars ?? {});
  useEffect(() => {
    if (cssRule === null) return;
    const styleEl = document.createElement("style");
    styleEl.textContent = cssRule;
    document.head.appendChild(styleEl);
    return () => {
      styleEl.remove();
    };
  }, [cssRule]);

  return <div ref={hostRef} id={hostId} className={className} />;
}
