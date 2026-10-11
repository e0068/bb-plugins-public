// Слой 1 — чисто. Ссылки в тексте брифа: агент пишет markdown-ссылку
// `[текст](цель)`, виджет показывает текст ссылкой. Цель — адрес, путь от
// корня дерева треда или абсолютный; у файла можно назвать строку —
// `файл.ts:12` или `файл.ts#L12`. Жирное `**…**` помечает свои части, ссылки
// внутри него тоже; ссылка разбирается раньше жирного, поэтому `**` в её пути
// (`docs/**/x.md`) жирное не открывает. Всё остальное остаётся текстом как есть.
import { resultLink } from "./result-link";

export type TextPart = ({ kind: "text"; text: string } | { kind: "link"; label: string; target: string; line: number | null }) & { strong?: true };

/** `[текст](цель)`; цель с пробелами — в угловых скобках, круглые скобки внутри цели — парами, как в `fn(x).ts`. */
const LINK = /\[([^[\]\n]+)\]\(\s*(?:<([^>\n]+)>|([^\s()]+(?:\([^\s()]*\)[^\s()]*)*))\s*\)/g;

/** Строка в конце пути: `:12`, `:12:5` с колонкой, `#L12` и диапазон `#L12-L20` — файл открывается на первой строке. */
const LINE = /(?:#L(\d+)(?:-L?\d+)?|:(\d+)(?::\d+)?)$/;

/** Цель ссылки без строки и строка, на которой файл откроется; у адреса строки нет. */
export const hrefTarget = (raw: string): { target: string; line: number | null } => {
  const line = resultLink(raw).kind === "url" ? null : LINE.exec(raw);
  return line === null ? { target: raw, line: null } : { target: raw.slice(0, line.index), line: Number(line[1] ?? line[2]) };
};

const link = (label: string, raw: string): TextPart => ({ kind: "link", label, ...hrefTarget(raw) });

const text = (value: string): TextPart[] => (value === "" ? [] : [{ kind: "text", text: value }]);

const linkParts = (value: string): TextPart[] => {
  const matches = [...value.matchAll(LINK)];
  const ends = [0, ...matches.map((m) => m.index + m[0].length)];
  return [...matches.flatMap((m, i) => [...text(value.slice(ends[i], m.index)), link(m[1]!, m[2] ?? m[3]!)]), ...text(value.slice(ends.at(-1)))];
};

const MARK = "**";

/** Части между ссылками, где каждое `**` — отдельная метка. */
type Piece = TextPart | { kind: "mark" };

const pieces = (parts: readonly TextPart[]): Piece[] =>
  parts.flatMap((part) =>
    part.kind === "link" ? [part] : part.text.split(MARK).flatMap((chunk, i): Piece[] => [...(i === 0 ? [] : [{ kind: "mark" as const }]), ...text(chunk)]),
  );

/** Жирное открывается вплотную к непробельному и закрывается так же: `** x**` и одинокий glob `docs/**` — текст. */
const opens = (next: Piece | undefined) => next !== undefined && (next.kind === "link" || (next.kind === "text" && /^\S/.test(next.text)));
const closes = (prev: Piece | undefined) => prev !== undefined && (prev.kind === "link" || (prev.kind === "text" && /\S$/.test(prev.text)));

/** Метки, сложившиеся в пары открытие–закрытие; метка без пары остаётся текстом. */
const pairedMarks = (all: readonly Piece[]): ReadonlySet<number> =>
  all.reduce<{ open: number | null; paired: readonly number[] }>(
    (state, piece, i) => {
      if (piece.kind !== "mark") return state;
      if (state.open !== null && closes(all[i - 1]) && i - 1 > state.open) return { open: null, paired: [...state.paired, state.open, i] };
      return opens(all[i + 1]) ? { ...state, open: i } : state;
    },
    { open: null, paired: [] },
  ).paired.reduce((set, i) => set.add(i), new Set<number>());

/** Соседние куски текста одной насыщенности — одна часть. */
const joined = (parts: readonly TextPart[]): TextPart[] =>
  parts.reduce<TextPart[]>((out, part) => {
    const last = out.at(-1);
    return last?.kind === "text" && part.kind === "text" && last.strong === part.strong ? [...out.slice(0, -1), { ...last, text: last.text + part.text }] : [...out, part];
  }, []);

export const textParts = (value: string): TextPart[] => {
  const all = pieces(linkParts(value));
  const paired = pairedMarks(all);
  const marked = all.reduce<{ strong: boolean; parts: readonly TextPart[] }>(
    (state, piece, i) =>
      piece.kind !== "mark"
        ? { ...state, parts: [...state.parts, state.strong ? { ...piece, strong: true as const } : piece] }
        : paired.has(i)
          ? { ...state, strong: !state.strong }
          : { ...state, parts: [...state.parts, state.strong ? { kind: "text", text: MARK, strong: true as const } : { kind: "text", text: MARK }] },
    { strong: false, parts: [] },
  ).parts;
  return joined(marked);
};

/** Код, строка таблицы, заголовок, цитата, пункт списка — то, что Kasimov рисует собой, помимо ссылок и жирного. */
const BLOCKS = /`[^`\n]+`|^\s*(?:\|.*\||#{1,6}\s|>\s|[-+*]\s|\d+[.)]\s)/m;

/** Курсив `*…*` и `_…_` вплотную к словам и зачёркнутое `~~…~~`; `2 * 3` и `snake_case` — текст. */
const EMPHASIS = /(?<![\w*])\*(?![\s*])[^*\n]*[^\s*]\*(?!\*)|(?<!\w)_(?!\s)[^_\n]*[^\s_]_(?!\w)|~~[^~\n]+~~/;

/** Есть ли в тексте разметка — ссылка, выделение, код, таблица, заголовок, цитата, список: такой текст рисуется, а не показывается как есть. */
export const hasMarkup = (value: string): boolean =>
  BLOCKS.test(value) || EMPHASIS.test(value) || textParts(value).some((part) => part.kind === "link" || part.strong === true);

/** Текст без разметки ссылок — для подписей экранного диктора: ссылка читается своим текстом. */
export const plainText = (value: string): string => textParts(value).map((part) => (part.kind === "text" ? part.text : part.label)).join("");
