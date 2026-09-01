// Чистый общий слой: настройки внешнего вида и флагов редактора Kasimov. Живёт
// в packages/md-doc-view, чтобы оба плагина-потребителя (Cloud Config, MD Opener)
// брали ОДНУ схему, но КАЖДЫЙ хранил СВОИ значения (раздельные настройки: своя
// bb.settings.define + свой useSettings у каждого плагина; межплагинной
// синхронизации нет — так решил владелец, decisions/kasimov-settings-separate).
//
// Одна таблица полей — единственный источник истины; из неё выводятся дескрипторы
// для bb.settings.define, тотальный разбор значений с доски и отображение в
// CSS-переменные (`--kasi-*`) и флаги движка. Эффектов нет: значения приходят от
// useSettings() (фронт), функции только преобразуют.
//
// Кегли/отступы/цвета/шрифты — строками: числового и цветового типа настроек в
// SDK нет (значение настройки — string | boolean | select-строка из
// фиксированных options). Флаги — булевы. Дефолты значением совпадают с
// packages/kasimov/kasimov.css (поэтому пустая/несозданная настройка сохраняет
// текущий вид) — px-поля хранят голое число ("14", не "14px": единицу
// дописывает toCssVars/withUnit, полю не нужно её нести).
//
// Шрифты/цвета дополнительно несут select-пресет (TOKEN_SELECT_FIELDS —
// готовые шрифты и токены темы хоста): пока он на "custom", действует
// текстовое поле как раньше; любое другое значение — сам этот пресет.

/** Плоское значение настройки, как его отдаёт useSettings().values. */
export type SettingValue = string | boolean;

export interface KasimovSettings {
  // Внешний вид (CSS-переменные).
  size: string;
  lineHeight: string;
  gap: string;
  radius: string;
  font: string;
  mono: string;
  fg: string;
  fgDim: string;
  bg: string;
  cellBg: string;
  accent: string;
  maxWidth: string;
  colMx: string;
  padX: string;
  paraGap: string;
  listGap: string;
  // Пресеты (select): готовое значение вместо соответствующего поля выше,
  // пока не выставлено в "custom". См. TOKEN_SELECT_FIELDS.
  fontToken: string;
  monoToken: string;
  fgToken: string;
  fgDimToken: string;
  bgToken: string;
  cellBgToken: string;
  accentToken: string;
  // Флаги движка.
  followLinks: boolean;
  atLinks: boolean;
  frontmatter: boolean;
  mermaidContrast: boolean;
}

type FlagField = "followLinks" | "atLinks" | "frontmatter" | "mermaidContrast";
type TokenField =
  | "fontToken"
  | "monoToken"
  | "fgToken"
  | "fgDimToken"
  | "bgToken"
  | "cellBgToken"
  | "accentToken";
type CssField = keyof Omit<KasimovSettings, FlagField | TokenField>;

/** Select не переопределяет поле, пока стоит на этом значении. */
const CUSTOM_TOKEN = "custom";

interface CssSpec {
  field: CssField;
  /** Ключ настройки на доске bb (уникален в пределах плагина). */
  key: string;
  /** CSS custom property, которую задаёт значение. */
  cssVar: string;
  default: string;
  label: string;
  description?: string;
  /**
   * `"px"` — поле принимает голое число ("8"), единицу дописывает toCssVars;
   * уже указанная единица или ключевое слово (px/%/auto/none/…) не трогается.
   * Не ставить для безразмерных значений (lineHeight) и не-числовых полей
   * (шрифты, цвета).
   */
  unit?: "px";
}

interface FlagSpec {
  field: FlagField;
  key: string;
  default: boolean;
  label: string;
  description?: string;
}

interface TokenSelectSpec {
  /** Настройка-select. */
  field: TokenField;
  /** Ключ настройки на доске bb. */
  key: string;
  /** Какое CSS-поле (из CSS_FIELDS) этот select переопределяет, пока не "custom". */
  target: CssField;
  label: string;
  description?: string;
  /** Готовые значения вида "var(--foo)" / font-stack; "custom" добавляется отдельно. */
  options: readonly string[];
}

// Токены хоста bb, встречающиеся в дизайн-системе (shadcn-подобные CSS
// custom properties, задаёт сам хост). Список наблюдаемый, не официальный —
// в этом монорепо нет их центрального реестра.
const HOST_COLOR_TOKENS = [
  "var(--foreground)",
  "var(--muted-foreground)",
  "var(--background)",
  "var(--card)",
  "var(--primary)",
  "var(--accent)",
  "var(--destructive)",
  "var(--border)",
  "var(--muted)",
  "var(--ring)",
  "var(--success)",
  "var(--attention)",
  "var(--canvas)",
  "var(--ink)",
  // --primary в теме bb ахроматичный; единственный цветной акцентный токен —
  // --timeline-accent (см. packages/md-doc-view/md-doc-view.css, откуда унаследован).
  "var(--timeline-accent)",
] as const;

const FONT_SANS_PRESETS = [
  "var(--font-sans)",
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  "Arial, Helvetica, sans-serif",
  '"Helvetica Neue", Helvetica, Arial, sans-serif',
  'Georgia, "Times New Roman", serif',
] as const;

const FONT_MONO_PRESETS = [
  "var(--font-mono)",
  "ui-monospace, SFMono-Regular, Menlo, monospace",
  '"Courier New", Courier, monospace',
  'Consolas, "Liberation Mono", monospace',
] as const;

export const TOKEN_SELECT_FIELDS: readonly TokenSelectSpec[] = [
  {
    field: "fontToken",
    key: "kasimovFontToken",
    target: "font",
    label: "Kasimov: основной шрифт — пресет",
    description: `«${CUSTOM_TOKEN}» — использовать поле «Kasimov: основной шрифт» ниже; var(--font-sans) — шрифт темы хоста`,
    options: FONT_SANS_PRESETS,
  },
  {
    field: "monoToken",
    key: "kasimovMonoToken",
    target: "mono",
    label: "Kasimov: моноширинный шрифт — пресет",
    description: `«${CUSTOM_TOKEN}» — использовать поле «Kasimov: моноширинный шрифт» ниже; var(--font-mono) — шрифт темы хоста`,
    options: FONT_MONO_PRESETS,
  },
  {
    field: "fgToken",
    key: "kasimovFgToken",
    target: "fg",
    label: "Kasimov: цвет текста — токен темы",
    description: `«${CUSTOM_TOKEN}» — использовать поле «Kasimov: цвет текста» ниже`,
    options: HOST_COLOR_TOKENS,
  },
  {
    field: "fgDimToken",
    key: "kasimovFgDimToken",
    target: "fgDim",
    label: "Kasimov: цвет приглушённого текста — токен темы",
    description: `«${CUSTOM_TOKEN}» — использовать поле «Kasimov: цвет приглушённого текста» ниже`,
    options: HOST_COLOR_TOKENS,
  },
  {
    field: "bgToken",
    key: "kasimovBgToken",
    target: "bg",
    label: "Kasimov: цвет фона (внутренние панели) — токен темы",
    description: `«${CUSTOM_TOKEN}» — использовать поле «Kasimov: цвет фона» ниже`,
    options: HOST_COLOR_TOKENS,
  },
  {
    field: "cellBgToken",
    key: "kasimovCellBgToken",
    target: "cellBg",
    label: "Kasimov: цвет ячеек/кода — токен темы",
    description: `«${CUSTOM_TOKEN}» — использовать поле «Kasimov: цвет ячеек/кода» ниже`,
    options: HOST_COLOR_TOKENS,
  },
  {
    field: "accentToken",
    key: "kasimovAccentToken",
    target: "accent",
    label: "Kasimov: акцентный цвет — токен темы",
    description: `«${CUSTOM_TOKEN}» — использовать поле «Kasimov: акцентный цвет» ниже`,
    options: HOST_COLOR_TOKENS,
  },
];

// Дефолты — из packages/kasimov/kasimov.css.
export const CSS_FIELDS: readonly CssSpec[] = [
  {
    field: "size",
    key: "kasimovFontSize",
    cssVar: "--kasi-size",
    default: "14",
    label: "Kasimov: кегль текста, px",
    description: "Размер шрифта редактора, напр. 14",
    unit: "px",
  },
  {
    field: "lineHeight",
    key: "kasimovLineHeight",
    cssVar: "--kasi-line-height",
    default: "1.5",
    label: "Kasimov: межстрочный интервал",
    description: "Высота строки тела, напр. 1.5",
  },
  {
    field: "gap",
    key: "kasimovGap",
    cssVar: "--kasi-gap",
    default: "4",
    label: "Kasimov: отступ, px",
    description: "Базовый вертикальный интервал блоков, напр. 4",
    unit: "px",
  },
  {
    field: "radius",
    key: "kasimovRadius",
    cssVar: "--kasi-radius",
    default: "8",
    label: "Kasimov: скругление, px",
    description: "Радиус скругления панелей/кода, напр. 8",
    unit: "px",
  },
  {
    field: "font",
    key: "kasimovFont",
    cssVar: "--kasi-font",
    default:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    label: "Kasimov: основной шрифт",
    description: "font-family для текста",
  },
  {
    field: "mono",
    key: "kasimovMono",
    cssVar: "--kasi-mono",
    default: "ui-monospace, SFMono-Regular, Menlo, monospace",
    label: "Kasimov: моноширинный шрифт",
    description: "font-family для кода",
  },
  {
    field: "fg",
    key: "kasimovFg",
    cssVar: "--kasi-fg",
    default: "#e8e8ea",
    label: "Kasimov: цвет текста",
  },
  {
    field: "fgDim",
    key: "kasimovFgDim",
    cssVar: "--kasi-fg-dim",
    default: "rgba(255, 255, 255, .5)",
    label: "Kasimov: цвет приглушённого текста",
  },
  {
    field: "bg",
    key: "kasimovBg",
    cssVar: "--kasi-bg",
    default: "#0e0e0e",
    label: "Kasimov: цвет фона (внутренние панели)",
  },
  {
    field: "cellBg",
    key: "kasimovCellBg",
    cssVar: "--kasi-cell-bg",
    default: "#1c1c1e",
    label: "Kasimov: цвет ячеек/кода",
  },
  {
    field: "accent",
    key: "kasimovAccent",
    cssVar: "--kasi-accent",
    default: "#d1603d",
    label: "Kasimov: акцентный цвет (ссылки)",
  },
  {
    field: "maxWidth",
    key: "kasimovMaxWidth",
    cssVar: "--kasi-max-width",
    default: "none",
    label: "Kasimov: макс. ширина колонки, px",
    description: "Ширина колонки, напр. 720; none — вся ширина",
    unit: "px",
  },
  {
    field: "colMx",
    key: "kasimovColMx",
    cssVar: "--kasi-col-mx",
    default: "0",
    label: "Kasimov: отступ колонки, px",
    description: "При заданной макс. ширине: 0 — влево, auto — по центру",
    unit: "px",
  },
  {
    field: "padX",
    key: "kasimovPadX",
    cssVar: "--kasi-pad-x",
    default: "44",
    label: "Kasimov: боковые поля, px",
    description: "Боковые «формат-поля» редактируемого полотна, напр. 44",
    unit: "px",
  },
  {
    field: "paraGap",
    key: "kasimovParaGap",
    cssVar: "--kasi-para-gap",
    default: "0",
    label: "Kasimov: отступ между абзацами, px",
    description: "Вертикальный интервал между абзацами/блоками, напр. 8",
    unit: "px",
  },
  {
    field: "listGap",
    key: "kasimovListGap",
    cssVar: "--kasi-list-gap",
    default: "0",
    label: "Kasimov: отступ между пунктами списка, px",
    description: "Доп. вертикальный интервал между пунктами, напр. 4",
    unit: "px",
  },
];

export const FLAG_FIELDS: readonly FlagSpec[] = [
  {
    field: "followLinks",
    key: "kasimovFollowLinks",
    default: true,
    label: "Kasimov: переход по ссылкам",
    description: "Клик по живой ссылке ведёт по ней вместо выделения токена",
  },
  {
    field: "atLinks",
    key: "kasimovAtLinks",
    default: true,
    label: "Kasimov: кликабельный @import",
    description: "`@path` (Claude @import) кликабелен; выкл — обычный текст",
  },
  {
    field: "frontmatter",
    key: "kasimovFrontmatter",
    default: true,
    label: "Kasimov: показывать frontmatter",
    description: "Показывать блок frontmatter сеткой (значение сохраняется)",
  },
  {
    field: "mermaidContrast",
    key: "kasimovMermaidContrast",
    default: false,
    label: "Kasimov: контрастные узлы mermaid",
    description: "Залитый чип с инверсным текстом; выкл — «мягкие» узлы (дефолт)",
  },
];

/** Дефолтные настройки — из таблиц полей (совпадают с kasimov.css). */
export const DEFAULTS: KasimovSettings = {
  ...(Object.fromEntries(
    CSS_FIELDS.map((f) => [f.field, f.default]),
  ) as Record<CssField, string>),
  ...(Object.fromEntries(
    TOKEN_SELECT_FIELDS.map((t) => [t.field, CUSTOM_TOKEN]),
  ) as Record<TokenField, string>),
  ...(Object.fromEntries(
    FLAG_FIELDS.map((f) => [f.field, f.default]),
  ) as Record<FlagField, boolean>),
};

const tokenSpecByTarget = new Map(TOKEN_SELECT_FIELDS.map((t) => [t.target, t]));

/**
 * Дефолт пресетов «под родной bb-вьюер» — общий для обоих потребителей
 * (MD Opener и Cloud Config), которые раньше добивались того же вида хардкодом
 * поверх Kasimov в общем packages/md-doc-view/md-doc-view.css (см.
 * memory/decisions/kasimov-opener-css-uses-token-defaults.md). Один источник —
 * не копия в каждом server.ts (G1). Все 7 полей TOKEN_SELECT_FIELDS покрыты
 * явно, включая `bgToken` (`--kasi-bg` управляет только внутренними панелями —
 * mermaid/зум, не фоном документа, но панели тоже часть «под родной вид»).
 */
export const NATIVE_VIEWER_TOKEN_DEFAULTS: Record<TokenField, string> = {
  fontToken: "var(--font-sans)",
  monoToken: "var(--font-mono)",
  fgToken: "var(--foreground)",
  fgDimToken: "var(--muted-foreground)",
  bgToken: "var(--background)",
  cellBgToken: "var(--muted)",
  accentToken: "var(--timeline-accent)",
};

/**
 * Дескрипторы для bb.settings.define (плоский объект key → дескриптор).
 * Порядок — из CSS_FIELDS; если у поля есть пресет (TOKEN_SELECT_FIELDS), его
 * select идёт СРАЗУ ПЕРЕД текстовым полем — описание пресета обещает «поле
 * ниже», и это обязано быть буквально так, а не где-то в хвосте списка.
 *
 * `tokenDefaults` — дефолт пресета (например `NATIVE_VIEWER_TOKEN_DEFAULTS`);
 * без него — `CUSTOM_TOKEN` на каждом поле (текстовое поле рулит).
 */
export function buildDescriptors(
  tokenDefaults: Partial<Record<TokenField, string>> = {},
) {
  const cssEntries = CSS_FIELDS.flatMap((f) => {
    const cssEntry = [
      f.key,
      {
        type: "string" as const,
        label: f.label,
        ...(f.description ? { description: f.description } : {}),
        default: f.default,
      },
    ] as const;
    const t = tokenSpecByTarget.get(f.field);
    if (!t) return [cssEntry];
    const tokenEntry = [
      t.key,
      {
        type: "select" as const,
        label: t.label,
        ...(t.description ? { description: t.description } : {}),
        options: [CUSTOM_TOKEN, ...t.options],
        default: tokenDefaults[t.field] ?? CUSTOM_TOKEN,
      },
    ] as const;
    return [tokenEntry, cssEntry];
  });
  return {
    ...Object.fromEntries(cssEntries),
    ...Object.fromEntries(
      FLAG_FIELDS.map((f) => [
        f.key,
        {
          type: "boolean" as const,
          label: f.label,
          ...(f.description ? { description: f.description } : {}),
          default: f.default,
        },
      ]),
    ),
  };
}

/** Дескрипторы с общими дефолтами (CUSTOM_TOKEN для всех пресетов). */
export const descriptors = buildDescriptors();

const allowedTokenValues = new Map(
  TOKEN_SELECT_FIELDS.map((t) => [t.field, new Set<string>([CUSTOM_TOKEN, ...t.options])]),
);

/**
 * Тотальный разбор значений с доски в настройки: берём значение нужного типа,
 * иначе — дефолт. `values` может быть undefined (грузится) — тогда всё дефолтное.
 * Мусор и лишние ключи отбрасываются самим устройством разбора (читаем только
 * известные ключи). Пресет (select) дополнительно сужен до своего списка
 * `options` — протухшее значение (список токенов правился, а на доске лежит
 * старое) падает на `CUSTOM_TOKEN`, а не летит в CSS как есть.
 */
export function parse(
  values: Record<string, SettingValue> | undefined,
): KasimovSettings {
  const v = values ?? {};
  const css = Object.fromEntries(
    CSS_FIELDS.map((f) => {
      const raw = v[f.key];
      return [f.field, typeof raw === "string" ? raw : f.default];
    }),
  ) as Record<CssField, string>;
  const tokens = Object.fromEntries(
    TOKEN_SELECT_FIELDS.map((t) => {
      const raw = v[t.key];
      const valid = typeof raw === "string" && allowedTokenValues.get(t.field)!.has(raw);
      return [t.field, valid ? (raw as string) : CUSTOM_TOKEN];
    }),
  ) as Record<TokenField, string>;
  const flags = Object.fromEntries(
    FLAG_FIELDS.map((f) => {
      const raw = v[f.key];
      return [f.field, typeof raw === "boolean" ? raw : f.default];
    }),
  ) as Record<FlagField, boolean>;
  return { ...css, ...tokens, ...flags };
}

const BARE_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Голое число ("8") получает единицу измерения; значение с уже указанной
 * единицей или ключевым словом (px/%/auto/none/…) возвращается как есть —
 * поля настроек принимают числа без px, писать его вручную не нужно.
 */
export function withUnit(value: string, unit: "px"): string {
  return BARE_NUMBER.test(value) ? `${value}${unit}` : value;
}

const tokenFieldByTarget = new Map(
  TOKEN_SELECT_FIELDS.map((t) => [t.target, t.field]),
);

/**
 * Итоговое значение CSS-поля: пресет (select), если у поля он есть и не стоит
 * на "custom"/пусто; иначе — текстовое поле. `parse()` уже гарантирует, что
 * пресет ∈ {"custom", ...options}, но `toCssVars` — самостоятельная чистая
 * функция над `KasimovSettings`, а не только над результатом `parse()`
 * (см. тесты, собирающие `KasimovSettings` руками), поэтому "" остаётся явно
 * проверяемым случаем, а не полагается на чужую гарантию.
 */
function effectiveCssValue(s: KasimovSettings, f: CssSpec): string {
  const tokenField = tokenFieldByTarget.get(f.field);
  const tokenValue = tokenField ? s[tokenField] : "";
  return tokenValue !== "" && tokenValue !== CUSTOM_TOKEN ? tokenValue : s[f.field];
}

/** CSS custom properties для host-элемента: только непустые значения (пусто = дефолт CSS). */
export function toCssVars(s: KasimovSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of CSS_FIELDS) {
    const value = effectiveCssValue(s, f);
    if (value === "") continue;
    out[f.cssVar] = f.unit ? withUnit(value, f.unit) : value;
  }
  return out;
}

/** Символы, которыми имя/значение переменной может вырваться за границу CSS-правила. */
const UNSAFE_CSS = /[{};<>]/;

/**
 * CSS-правило `#hostId .mde-root { --var: значение; … }` для инъекции в
 * document.head (см. KasimovEditor). `null`, если задавать нечего.
 *
 * Значения приходят голыми строками с доски настроек (не типизированы и не
 * валидируются формой — kasimovFontSize и т.п. хранят что угодно), поэтому
 * пары, чьё имя или значение может разорвать правило и вылезти в соседний
 * CSS (`{`, `}`, `;`, `<`, `>`), тотально отбрасываются, а не проверяются на
 * вызывающей стороне.
 */
export function kasimovCssRule(
  hostId: string,
  vars: Record<string, string>,
): string | null {
  const decls = Object.entries(vars)
    .filter(([name, value]) => !UNSAFE_CSS.test(name) && !UNSAFE_CSS.test(value))
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
  return decls === "" ? null : `#${hostId} .mde-root { ${decls} }`;
}

/** Опции движка для KasimovEditor: булевы флаги + строковый режим mermaid. */
export function toFlags(s: KasimovSettings): {
  followLinks: boolean;
  atLinks: boolean;
  frontmatter: boolean;
  mermaidNodes: "soft" | "contrast";
} {
  return {
    followLinks: s.followLinks,
    atLinks: s.atLinks,
    frontmatter: s.frontmatter,
    // Бинарный выбор режима mermaid → строковая опция движка (soft — дефолт).
    mermaidNodes: s.mermaidContrast ? "contrast" : "soft",
  };
}
