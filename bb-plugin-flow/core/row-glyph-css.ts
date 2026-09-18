// Слой 1 — чисто. Стиль, которым рисуются значки Flow в строке треда: хост
// берёт у статуса имя иконки из своего реестра, а нужных рисунков там нет.
// Приём хоста — маска поверх currentColor, поэтому цвет значка — цвет строки.
// Селектор держится на `aria-label`: чужое имя иконки хост меняет на Zap,
// а подпись ставит как есть.

import { mutedBlinkAnimation, mutedBlinkKeyframes } from "./muted-blink";

/**
 * Рисунок значка по подписи; `blink` — значок мигает, пока этап идёт. `logo` — логотип провайдера вместо рисунка:
 * у субагента `framed` — в контурном квадрате, вдвое меньше.
 */
export type GlyphOverride = { label: string; svg: string; blink?: boolean; logo?: { url: string; framed: boolean } };

/** Контурный квадрат во весь значок, штрихом как у Hugeicons. */
const FRAME_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect x="2.75" y="2.75" width="18.5" height="18.5" rx="5" stroke="black" stroke-width="1.5"/></svg>';

const escapeAttr = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Адрес для `url("…")` в CSS: кавычка, обратная косая и переводы строк — процент-кодами, чтобы строка не рвалась. */
export const cssUrl = (url: string): string => `url("${url.replace(/["\\\n\r]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)}")`;

const svgUrl = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** Слои маски с размером каждого: рисунок, логотип или квадрат с логотипом внутри. */
const layersOf = ({ svg, logo }: GlyphOverride): Array<readonly [string, string]> => {
  if (logo === undefined) return [[svgUrl(svg), "contain"]];
  const url = cssUrl(logo.url);
  return logo.framed ? [[svgUrl(FRAME_SVG), "contain"], [url, "50%"]] : [[url, "contain"]];
};

const ruleFor = (glyph: GlyphOverride): string => {
  const target = `[data-sidebar-thread-trailing-indicator] [aria-label="${escapeAttr(glyph.label)}"]`;
  const layers = layersOf(glyph);
  const images = layers.map(([image]) => image).join(",");
  const sizes = layers.map(([, size]) => size).join(",");
  const mask = [
    "background-color:currentColor",
    `-webkit-mask-image:${images}`,
    `mask-image:${images}`,
    "-webkit-mask-position:center",
    "mask-position:center",
    "-webkit-mask-repeat:no-repeat",
    "mask-repeat:no-repeat",
    `-webkit-mask-size:${sizes}`,
    `mask-size:${sizes}`,
    ...(glyph.blink === true ? [`animation:${mutedBlinkAnimation}`] : []),
  ].join(";");
  return `${target}{${mask}}\n${target}>*{display:none}`;
};

/** Весь стиль; пустой список — пустая строка. */
export const glyphCss = (overrides: readonly GlyphOverride[]): string =>
  [...overrides.map(ruleFor), ...(overrides.some((o) => o.blink === true) ? [mutedBlinkKeyframes] : [])].join("\n");
