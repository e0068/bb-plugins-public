// Слой 1 — чисто. Текст агента кусками: блоки ```mermaid … ``` — отдельно, остальное — текстом как есть. Абзацы, списки
// и ссылки в текстовых кусках режут свои разборщики; блок без закрывающих бэктиков остаётся текстом.

export type FencedPart = { kind: "text"; text: string } | { kind: "diagram"; source: string };

const FENCE = /^[ \t]*```mermaid[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gm;

const textPart = (text: string): FencedPart[] => (text.trim() === "" ? [] : [{ kind: "text", text }]);

/** Куски по порядку; текст без блока mermaid — один текстовый кусок, пустой текст — ни одного. */
export const fencedParts = (text: string): FencedPart[] => {
  const matches = [...text.matchAll(FENCE)];
  const ends = matches.map((match) => match.index + match[0].length);
  const starts = [0, ...ends];
  return [
    ...matches.flatMap((match, i): FencedPart[] => [...textPart(text.slice(starts[i], match.index)), { kind: "diagram", source: match[1]!.trim() }]),
    ...textPart(text.slice(starts[matches.length])),
  ];
};
