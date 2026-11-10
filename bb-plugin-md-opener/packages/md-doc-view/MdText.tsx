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
// the editor, while new text is only set into the one already there. A picture
// with a relative `src` asks the image resolver for its address the same way,
// and one with an absolute file path is rewritten through the resolver before
// the engine sees the text (image-paths.ts). Without a resolver the engine
// draws a "caption — path" placeholder, and a picture whose address doesn't
// load is swapped for the same placeholder — the engine itself leaves a broken
// image there. A live link is a bare span in the engine's markup; after each
// render it is given a link's role and focus, and Enter on it clicks it.
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { createEditor } from "../kasimov/kasimov.js";
import type { KasimovEditorInstance, KasimovLink } from "../kasimov/kasimov.js";
import "../kasimov/kasimov.css";
import "./md-doc-view.css";
import "./md-text.css";
import { resolveImagePaths } from "./image-paths";
import { MD_TEXT_CLASS, mdTextRule } from "./md-text";

export interface MdTextProps {
  text: string;
  /** Live link → what a click does; `null` leaves it plain text. Keep it stable: a new one redraws the text. */
  linkResolver: (href: string) => KasimovLink | null;
  /** A picture's relative `src` or absolute file path → the address to load it from; `null` or absent leaves the placeholder. Keep it stable too. */
  imageResolver?: ((src: string) => string | null) | undefined;
}

const STYLE_ID = "mdt-vars";
const LIVE_LINK = ".mde-link-live";
const PICTURE = "img.mde-imgpic";

const span = (doc: Document, className: string, text?: string): HTMLSpanElement => {
  const node = doc.createElement("span");
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** The engine's own placeholder markup (placeholder in ../kasimov/kasimov.js): a mark, then "caption — path". */
const placeholder = (img: HTMLImageElement, src: string): HTMLSpanElement => {
  const doc = img.ownerDocument;
  const box = span(doc, "mde-ctl mde-imgerr");
  box.append(span(doc, "mde-imgerr-mark", "🖼"), span(doc, "mde-imgerr-text", (img.alt ? `${img.alt} — ` : "") + src));
  return box;
};

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

export function MdText({ text, linkResolver, imageResolver }: MdTextProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const editorRef = useRef<KasimovEditorInstance | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  // Text → what the engine gets: absolute picture paths already resolved.
  const prepareRef = useRef((value: string) => value);

  // Layout effects, not passive ones: the text lands in the DOM in the same
  // commit as the card around it, so no frame shows an empty field.
  useLayoutEffect(() => {
    const host = hostRef.current!;
    ensureRule(host.ownerDocument);
    // Address → the path written in the text, for the placeholder of a picture that didn't load.
    const sources = new Map<string, string>();
    const remember = (resolve: (src: string) => string | null) => (src: string) => {
      const url = resolve(src);
      if (url !== null) sources.set(url, src);
      return url;
    };
    const onError = (event: Event): void => {
      if (!(event.target instanceof HTMLImageElement) || !event.target.matches(PICTURE)) return;
      const url = event.target.getAttribute("src") ?? "";
      event.target.replaceWith(placeholder(event.target, sources.get(url) ?? url));
    };
    // An image's error doesn't bubble: the host hears it on the way down.
    host.addEventListener("error", onError, true);
    const resolveImage = imageResolver === undefined ? undefined : remember(imageResolver);
    prepareRef.current = (value) => (resolveImage === undefined ? value : resolveImagePaths(value, resolveImage));
    const editor = createEditor(host, {
      value: prepareRef.current(textRef.current),
      editable: false,
      followLinks: true,
      atLinks: false,
      frontmatter: false,
      linkResolver,
      ...(resolveImage === undefined ? {} : { imageResolver: resolveImage }),
    });
    markLinks(host);
    editorRef.current = editor;
    return () => {
      host.removeEventListener("error", onError, true);
      editor.destroy();
      editorRef.current = null;
    };
  }, [linkResolver, imageResolver]);

  useLayoutEffect(() => {
    const value = prepareRef.current(text);
    if (editorRef.current === null || editorRef.current.getValue() === value) return;
    editorRef.current.setValue(value);
    markLinks(hostRef.current!);
  }, [text]);

  return <span ref={hostRef} className={`${MD_TEXT_CLASS} mdo-mde`} onKeyDown={onKeyDown} />;
}
