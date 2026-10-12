// Слой 2 — чисто. Метки картинок в тексте ответа на бриф: «[картинка 1]» встаёт в поле при вставке картинки, и поле
// рисует её плашкой. Вид метки задаёт язык интерфейса — функция `marker` из сообщений.

/** Кусок текста: обычный текст или метка картинки. */
export type MarkedPart = { text: string; marker: boolean };

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Вид метки по номеру: «[картинка N]», «[файл N]». */
export type Marker = (n: number) => string;

/** Шаблон меток по их видам: номер в `marker(0)` заменён на любое число; у каждого вида своя группа номера. */
const markerPattern = (marker: Marker | readonly Marker[]): RegExp =>
  new RegExp(
    (typeof marker === "function" ? [marker] : marker)
      .map((one) => {
        const [before = "", after = ""] = one(0).split("0");
        return `${escape(before)}(\\d+)${escape(after)}`;
      })
      .join("|"),
    "g",
  );

/** Номер найденной метки — из группы того вида, что совпал. */
const numberOf = (match: RegExpMatchArray): number => Number(match.slice(1).find((group) => group !== undefined));

/** Текст кусками по порядку; склейка кусков — исходный текст. */
export const splitMarkers = (text: string, marker: Marker | readonly Marker[]): MarkedPart[] => {
  const parts: MarkedPart[] = [];
  let at = 0;
  for (const match of text.matchAll(markerPattern(marker))) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index), marker: false });
    parts.push({ text: match[0], marker: true });
    at = match.index + match[0].length;
  }
  return at < text.length ? [...parts, { text: text.slice(at), marker: false }] : parts;
};

/** Номера картинок, на которые ссылается текст, — по первому появлению метки. */
export const markerNumbers = (text: string, marker: Marker | readonly Marker[]): number[] => [
  ...new Set([...text.matchAll(markerPattern(marker))].map(numberOf)),
];

/** Текст без метки картинки `n`: каждое её вхождение уходит вместе с одним пробелом рядом, чтобы слова не слиплись и не разошлись. */
export const withoutMarker = (text: string, n: number, marker: Marker): string => {
  const tag = escape(marker(n));
  return text.replace(new RegExp(`${tag} | ?${tag}`, "g"), "");
};
