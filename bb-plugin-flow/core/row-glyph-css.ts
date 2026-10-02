// Слой 1 — чисто. Стиль, которым рисуются значки Flow в строке треда: хост
// берёт у статуса имя иконки из своего реестра, а нужных рисунков там нет.
// Приём хоста — маска поверх currentColor, поэтому цвет значка — цвет строки.
// Селектор держится на `aria-label`: чужое имя иконки хост меняет на Zap,
// а подпись ставит как есть. Тем же приёмом колёсико хода хоста в строке треда
// с flow становится логотипом провайдера.

import { mutedBlinkAnimation, mutedBlinkKeyframes } from "./muted-blink";

/** Рисунок значка по подписи; `blink` — значок мигает, пока этап идёт. */
export type GlyphOverride = { label: string; svg: string; blink?: boolean };

/** Логотип провайдера треда: им рисуется колёсико хода bb в строке этого треда. */
export type SpinnerLogo = { threadId: string; logoUrl: string };

const escapeAttr = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Адрес для `url("…")` в CSS: кавычка, обратная косая и переводы строк — процент-кодами, чтобы строка не рвалась. */
export const cssUrl = (url: string): string => `url("${url.replace(/["\\\n\r]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)}")`;

const svgUrl = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** Рисунок маской цветом строки; собственный рисунок элемента прячется. */
const maskRule = (target: string, image: string, extra: readonly string[] = []): string => {
  const mask = [
    "background-color:currentColor",
    `-webkit-mask-image:${image}`,
    `mask-image:${image}`,
    "-webkit-mask-position:center",
    "mask-position:center",
    "-webkit-mask-repeat:no-repeat",
    "mask-repeat:no-repeat",
    "-webkit-mask-size:contain",
    "mask-size:contain",
    ...extra,
  ].join(";");
  return `${target}{${mask}}\n${target}>*{display:none}`;
};

const ruleFor = (glyph: GlyphOverride): string =>
  maskRule(`[data-sidebar-thread-trailing-indicator] [aria-label="${escapeAttr(glyph.label)}"]`, svgUrl(glyph.svg), glyph.blink === true ? [`animation:${mutedBlinkAnimation}`] : []);

/**
 * Колёсико хода — иконка `Loading` хоста — в строке треда получает логотип его провайдера; вращение остаётся хостовым.
 * Признак строки хост ставит и на обёртку группы, поэтому строка — та, где ссылка треда не во вложенной строке,
 * а колёсико — в её собственном хвосте: иначе логотип одного треда лёг бы на колёсики всей группы.
 * Хост переименует иконку или атрибуты строки — селектор промахнётся, и вернётся обычное колёсико.
 */
const spinnerRuleFor = ({ threadId, logoUrl }: SpinnerLogo): string => {
  const link = `a[data-sidebar-thread-id="${escapeAttr(threadId)}"]`;
  const ownRow = `[data-sidebar-rename-row]:has(${link}):not(:has([data-sidebar-rename-row] ${link}))`;
  return maskRule(`${ownRow} > [data-sidebar-thread-trailing] [data-sidebar-thread-trailing-indicator] > [data-icon="Loading"]`, cssUrl(logoUrl));
};

/** Весь стиль; пустые списки — пустая строка. */
export const glyphCss = (overrides: readonly GlyphOverride[], spinners: readonly SpinnerLogo[] = []): string =>
  [...overrides.map(ruleFor), ...spinners.map(spinnerRuleFor), ...(overrides.some((o) => o.blink === true) ? [mutedBlinkKeyframes] : [])].join("\n");
