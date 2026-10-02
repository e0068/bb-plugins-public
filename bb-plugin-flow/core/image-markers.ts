// Слой 2 — чисто. Метки картинок в тексте ответа на бриф: «[картинка 1]» встаёт в поле при вставке картинки, и поле
// рисует её плашкой. Вид метки задаёт язык интерфейса — функция `marker` из сообщений.

/** Кусок текста: обычный текст или метка картинки. */
export type MarkedPart = { text: string; marker: boolean };

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Шаблон метки по её виду: номер в `marker(0)` заменён на любое число. */
const markerPattern = (marker: (n: number) => string): RegExp => {
  const [before = "", after = ""] = marker(0).split("0");
  return new RegExp(`${escape(before)}\\d+${escape(after)}`, "g");
};

/** Текст кусками по порядку; склейка кусков — исходный текст. */
export const splitMarkers = (text: string, marker: (n: number) => string): MarkedPart[] => {
  const parts: MarkedPart[] = [];
  let at = 0;
  for (const match of text.matchAll(markerPattern(marker))) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index), marker: false });
    parts.push({ text: match[0], marker: true });
    at = match.index + match[0].length;
  }
  return at < text.length ? [...parts, { text: text.slice(at), marker: false }] : parts;
};
