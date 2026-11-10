// Kasimov (MD Opener): палитра круговых диаграмм mermaid, которые bb рисует в
// чате. Чистая функция без эффектов: content-скрипт только кладёт её результат в <head>.
//
// Почему пирог серый. bb рисует mermaid темой `base` и отдаёт ей цвета из трёх
// переменных темы — `--secondary`, `--muted`, `--accent`. Двенадцать цветов
// пирога mermaid выводит из них сдвигом оттенка; в тёмной теме все три одинаково
// серые, у серого оттенка нет, и все дольки выходят одним цветом.
//
// Как перекрашиваем. Mermaid даёт дольке и строке легенды цвет по порядку
// строки в исходнике и идёт по кругу после двенадцатого; в SVG дольки — пути
// `pieCircle` подряд в своей группе, а строки легенды — группы `legend` после
// группы долек. Поэтому n-я долька и n-я легенда получают n-й цвет по :nth-of-type.
//
// Почему нужна сверка. Секции меньше процента — чаще всего нули, «Failed 0», —
// mermaid дольки не рисует, а в легенде оставляет. Тогда n-я долька и n-я строка
// легенды говорят о разных секциях, и одинаковый цвет соврёт. Сосчитать узлы
// CSS не умеет, поэтому content-скрипт ставит пирогу отметку `pieMark`, и
// красится только выверенный пирог; сбитый остаётся таким, как его нарисовал bb.
//
// Разметка bb — не API (bb 0.49, mermaid 11): правила привязаны к id
// `bb-mermaid-…`, который bb даёт своим диаграммам, и к типу `pie`, который
// mermaid пишет в aria-roledescription, — другие диаграммы и чужие пироги не задеваются.

/** Тёмная тема: насыщенные средние тона, на них читается светлый текст процентов. */
export const DARK_PIE_PALETTE: readonly string[] = [
  "#2563eb",
  "#d97706",
  "#059669",
  "#db2777",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
  "#65a30d",
  "#c026d3",
  "#ea580c",
  "#0d9488",
  "#4f46e5",
];

/** Светлая тема: светлые тона того же порядка, на них читается тёмный текст процентов. */
export const LIGHT_PIE_PALETTE: readonly string[] = [
  "#93c5fd",
  "#fcd34d",
  "#6ee7b7",
  "#f9a8d4",
  "#c4b5fd",
  "#67e8f9",
  "#fca5a5",
  "#bef264",
  "#f0abfc",
  "#fdba74",
  "#5eead4",
  "#a5b4fc",
];

/** Диаграммы bb, которые палитра перекрашивает: пироги, нарисованные самим bb. */
export const BB_PIE_SELECTOR = `svg[id^="bb-mermaid-"][aria-roledescription="pie"]`;

/** Атрибут, в котором content-скрипт пишет пирогу итог сверки. */
export const PIE_MARK_ATTR = "data-wc-pie";

/** Итог сверки: у каждой строки легенды своя долька — или какая-то секция без дольки. */
export type PieMark = "aligned" | "skewed";

/** Сверка пирога по числу долек и строк легенды. */
export const pieMark = (slices: number, legends: number): PieMark =>
  slices > 0 && slices === legends ? "aligned" : "skewed";

const ALIGNED_PIE = `${BB_PIE_SELECTOR}[${PIE_MARK_ATTR}="aligned"]`;

/** Правила одной палитры: n-я долька и квадратик n-й легенды — n-й цвет, по кругу. */
const paletteRules = (scope: string, palette: readonly string[]): string =>
  palette
    .map((color, i) => {
      const slice = `${scope} path.pieCircle:nth-of-type(${palette.length}n+${i + 1})`;
      // Первая группа-сестра легенд — группа долек, поэтому легенда на одну позицию дальше.
      const swatch = `${scope} g.legend:nth-of-type(${palette.length}n+${i + 2}) > rect`;
      // Квадратик легенды mermaid красит инлайн-стилем — его перебивает только !important.
      return `${slice}{fill:${color}}\n${swatch}{fill:${color} !important;stroke:${color} !important}`;
    })
    .join("\n");

/** Таблица палитры выверенных пирогов bb: светлые правила, затем тёмные — у них выше специфичность. */
export const diagramPaletteCss = (): string =>
  [paletteRules(ALIGNED_PIE, LIGHT_PIE_PALETTE), paletteRules(`.dark ${ALIGNED_PIE}`, DARK_PIE_PALETTE)].join("\n");
