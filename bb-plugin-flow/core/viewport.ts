// Слой 2 — чисто. Тег viewport страницы bb без автозума: iPhone приближает страницу, когда фокус встаёт в поле
// с текстом мельче 16 px, и перестаёт, когда тег держит предел масштаба 1. Щипок Safari оставляет и с пределом.

const LIMIT = "maximum-scale=1";

/** Содержимое тега viewport с пределом масштаба 1; прочие пары остаются на своих местах. */
export const withoutAutoZoom = (content: string): string => {
  const pairs = content.split(",").map((pair) => pair.trim()).filter((pair) => pair !== "");
  const others = pairs.filter((pair) => !/^maximum-scale\s*=/.test(pair));
  if (others.length < pairs.length && pairs.some((pair) => pair.replace(/\s/g, "") === LIMIT)) return content;
  return [...others, LIMIT].join(", ");
};
