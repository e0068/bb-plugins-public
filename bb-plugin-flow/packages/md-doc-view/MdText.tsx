/// <reference path="./kasimov.d.ts" />
// A piece of markdown text in Kasimov's read mode — the way MD Opener draws a
// document, for text a consumer assembled rather than read from a file: a
// field of a card, a note. No path, no modes, no history — that is MdDocView.
// The engine is imported the same relative way as in KasimovEditor (see
// docs/decisions/md-opener-vendor-kasimov.md); md-doc-view.css brings MD
// Opener's skin of the engine (headings, inline code, quotes), hung on
// `mdo-mde`.
//
// The engine decides at render whether a link is live, by asking the resolver
// once — so a new resolver (the consumer learned where files are) recreates
// the editor, while new text is only set into the one already there. A live
// link is a bare span in the engine's markup; after each render it is given a
// link's role and focus, and Enter on it clicks it.
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createEditor } from "../kasimov/kasimov.js";
import type { KasimovEditorInstance, KasimovLink } from "../kasimov/kasimov.js";
import "../kasimov/kasimov.css";
import "./md-doc-view.css";
import "./md-text.css";
import { MD_TEXT_CLASS, mdTextRule } from "./md-text";

export interface MdTextProps {
  text: string;
  /** Live link → what a click does; `null` leaves it plain text. Keep it stable: a new one redraws the text. */
  linkResolver: (href: string) => KasimovLink | null;
}

const STYLE_ID = "mdt-vars";
const LIVE_LINK = ".mde-link-live";

const markLinks = (host: HTMLElement): void =>
  host.querySelectorAll<HTMLElement>(LIVE_LINK).forEach((link) => {
    link.setAttribute("role", "link");
    link.tabIndex = 0;
  });

const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
  if (event.key === "Enter" && event.target instanceof HTMLElement && event.target.matches(LIVE_LINK)) event.target.click();
};

const ensureRule = (doc: Document): void => {
  if (doc.getElementById(STYLE_ID) !== null) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = mdTextRule;
  doc.head.append(style);
};

export function MdText({ text, linkResolver }: MdTextProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const editorRef = useRef<KasimovEditorInstance | null>(null);
  const textRef = useRef(text);
  textRef.current = text;

  // Layout effects, not passive ones: the text lands in the DOM in the same
  // commit as the card around it, so no frame shows an empty field.
  useLayoutEffect(() => {
    const host = hostRef.current!;
    ensureRule(host.ownerDocument);
    const editor = createEditor(host, {
      value: textRef.current,
      editable: false,
      followLinks: true,
      atLinks: false,
      frontmatter: false,
      linkResolver,
    });
    markLinks(host);
    editorRef.current = editor;
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [linkResolver]);

  useLayoutEffect(() => {
    if (editorRef.current === null || editorRef.current.getValue() === text) return;
    editorRef.current.setValue(text);
    markLinks(hostRef.current!);
  }, [text]);

  return <span ref={hostRef} className={`${MD_TEXT_CLASS} mdo-mde`} onKeyDown={onKeyDown} />;
}
