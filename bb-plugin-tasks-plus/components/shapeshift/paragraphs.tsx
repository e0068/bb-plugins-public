// Vendored from Shapeshift generated/ at 99c0c0e — docs/decisions/tasks-plus-shapeshift-vendored.md. Copy again instead of editing by hand.
import { createContext, useContext, type ReactNode } from 'react';

type Paragraph = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'item'; readonly marker: string; readonly text: string };

const MARKER = /^(?:[-•*]|\d+\.) +/;

const paragraphOf = (line: string): Paragraph => {
  const marker = MARKER.exec(line)?.[0];
  return marker === undefined ? { kind: 'text', text: line } : { kind: 'item', marker, text: line.slice(marker.length) };
};

const block = (p: Paragraph, key: number): ReactNode =>
  p.kind === 'item' ? (
    <span key={key} className="ss-tp ss-tl"><span>{p.marker}</span><span>{p.text}</span></span>
  ) : (
    <span key={key} className="ss-tp">{p.text}</span>
  );

type Modes = Readonly<Record<string, string>>;
type TextEntry = { readonly by: readonly string[]; readonly values: Readonly<Record<string, string>> };

/** Режимы `ModesRoot` по id коллекции; без корня — первые режимы коллекций. */
export const ModesContext = createContext<Modes>({});

const FIRST: Modes = {"brand":"A","theme":"Light","language":"RU","density":"Compact","breakpoint":"Mobile"};

const TEXTS: Readonly<Record<string, TextEntry>> = {"brand/font":{"by":["brand"],"values":{"A":"Inter, system-ui, sans-serif","B":"Georgia, serif","S":"Inter, system-ui, sans-serif"}},"brand/font-mono":{"by":["brand"],"values":{"A":"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace","B":"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace","S":"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"}},"font/mono":{"by":[],"values":{"":"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"}},"font/sans":{"by":[],"values":{"":"Inter, system-ui, sans-serif"}},"font/serif":{"by":[],"values":{"":"Georgia, serif"}},"shell/scheme":{"by":["brand","theme"],"values":{"A/Light":"light","A/Dark":"dark","B/Light":"light","B/Dark":"dark","S/Light":"light","S/Dark":"dark"}}};

/** Текст-ссылка `{путь}` строковой переменной — её строка в режимах `modes`; остальное — сам текст. */
const textOf = (content: string, modes: Modes): string => {
  const path = /^\{(.+)\}$/.exec(content)?.[1];
  const entry = path !== undefined && Object.hasOwn(TEXTS, path) ? TEXTS[path] : undefined;
  if (entry === undefined) return content;
  const key = entry.by.map((c) => modes[c] ?? FIRST[c] ?? '').join('/');
  return Object.hasOwn(entry.values, key) ? (entry.values[key] ?? content) : content;
};

const Text = ({ content }: { readonly content: string }): ReactNode => {
  const shown = textOf(content, useContext(ModesContext));
  const ps = shown.split(/\r?\n/).map(paragraphOf);
  const [only] = ps;
  return ps.length === 1 && only?.kind === 'text' ? shown : ps.map(block);
};

/** Содержимое текстового узла: текст-ссылка — строкой своей переменной; единственный обычный абзац — сама строка;
 * иначе блоки абзацев и пунктов списка. */
export const paragraphs = (content: string): ReactNode => <Text content={content} />;
