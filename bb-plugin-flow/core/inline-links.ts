// Слой 1 — чисто. Ссылки в тексте брифа: агент пишет markdown-ссылку
// `[текст](цель)`, виджет показывает текст ссылкой. Цель — адрес, путь от
// корня дерева треда или абсолютный; у файла можно назвать строку —
// `файл.ts:12` или `файл.ts#L12`. Всё, что не ссылка, остаётся текстом как есть.
import { resultLink } from "./result-link";

export type TextPart = { kind: "text"; text: string } | { kind: "link"; label: string; target: string; line: number | null };

/** `[текст](цель)`; цель с пробелами — в угловых скобках, круглые скобки внутри цели — парами, как в `fn(x).ts`. */
const LINK = /\[([^[\]\n]+)\]\(\s*(?:<([^>\n]+)>|([^\s()]+(?:\([^\s()]*\)[^\s()]*)*))\s*\)/g;

/** Строка в конце пути: `:12`, `:12:5` с колонкой, `#L12` и диапазон `#L12-L20` — файл открывается на первой строке. */
const LINE = /(?:#L(\d+)(?:-L?\d+)?|:(\d+)(?::\d+)?)$/;

const link = (label: string, raw: string): TextPart => {
  const line = resultLink(raw).kind === "url" ? null : LINE.exec(raw);
  return line === null ? { kind: "link", label, target: raw, line: null } : { kind: "link", label, target: raw.slice(0, line.index), line: Number(line[1] ?? line[2]) };
};

const text = (value: string): TextPart[] => (value === "" ? [] : [{ kind: "text", text: value }]);

export const textParts = (value: string): TextPart[] => {
  const matches = [...value.matchAll(LINK)];
  const ends = [0, ...matches.map((m) => m.index + m[0].length)];
  return [...matches.flatMap((m, i) => [...text(value.slice(ends[i], m.index)), link(m[1]!, m[2] ?? m[3]!)]), ...text(value.slice(ends.at(-1)))];
};

export const hasLinks = (value: string): boolean => textParts(value).some((part) => part.kind === "link");

/** Текст без разметки ссылок — для подписей экранного диктора: ссылка читается своим текстом. */
export const plainText = (value: string): string => textParts(value).map((part) => (part.kind === "text" ? part.text : part.label)).join("");
