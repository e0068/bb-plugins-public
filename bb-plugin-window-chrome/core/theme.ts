// Window Chrome, ядро: значения темы окна — цвета палитры bb для светлой и
// тёмной темы, скругления, отступы, размеры — их разбор и CSS из них. Чистые
// функции: одна и та же таблица идёт и в живое применение, и в файл темы bb.
//
// Пустое поле значит «как в текущей теме bb»: в таблицу попадает только
// заданное, остальное bb берёт из своей темы.

/** Сигнал realtime: значения темы поменялись. */
export const THEME_CHANGED = "window-chrome:theme";

export type Mode = "light" | "dark";

export type ColorId =
  | "canvas"
  | "sidebar"
  | "card"
  | "popover"
  | "ink"
  | "muted-foreground"
  | "border"
  | "primary"
  | "success"
  | "warning"
  | "destructive";

export type NumberId =
  | "radius"
  | "islandRadius"
  | "padStep"
  | "marginStep"
  | "gapStep"
  | "lip"
  | "sizeStep"
  | "chromeRow"
  | "listRow"
  | "fontSize";

export type Palette = Partial<Record<ColorId, string>>;

/** Всё, что задаёт владелец; любое поле может отсутствовать. */
export type ThemeValues = Partial<Record<NumberId, number>> & {
  readonly light?: Palette;
  readonly dark?: Palette;
  /** Фон за островом — один на обе темы. */
  readonly backdrop?: string;
};

export interface ColorField {
  readonly id: ColorId;
  readonly label: string;
  /** Переменные bb, которые тема bb выводит из других цветов, а поле обещает тоже: им пишется то же значение. */
  readonly alsoSets?: readonly string[];
}

export interface NumberField {
  readonly id: NumberId;
  readonly label: string;
  readonly hint?: string;
  /** Значение bb 0.46, px: подсказка пустого поля и шаг, от которого отсчитываются отступы. */
  readonly bb: number;
  readonly min: number;
  readonly max: number;
}

export interface FieldGroup<Field> {
  readonly title: string;
  readonly items: readonly Field[];
}

/** Цвета палитры bb; id — имя переменной темы bb без `--`. */
export const COLOR_GROUPS: readonly FieldGroup<ColorField>[] = [
  {
    title: "Поверхности",
    items: [
      { id: "canvas", label: "Фон" },
      { id: "sidebar", label: "Панель тредов" },
      { id: "card", label: "Карточки" },
      { id: "popover", label: "Всплывающие окна" },
    ],
  },
  {
    title: "Текст и линии",
    items: [
      { id: "ink", label: "Текст" },
      { id: "muted-foreground", label: "Приглушённый текст" },
      // Рамки полей, панели тредов и швы острова bb смешивает из текста и фона, а не из --border.
      { id: "border", label: "Линии", alsoSets: ["--input", "--sidebar-border", "--border-hairline", "--border-seam"] },
    ],
  },
  {
    title: "Акцент и статусы",
    items: [
      { id: "primary", label: "Акцент" },
      { id: "success", label: "Успех" },
      // Текст предупреждений и ошибок у bb — свои цвета, не выведенные из фона статуса.
      { id: "warning", label: "Предупреждение", alsoSets: ["--warning-text"] },
      { id: "destructive", label: "Ошибка", alsoSets: ["--destructive-text"] },
    ],
  },
];

export const NUMBER_GROUPS: readonly FieldGroup<NumberField>[] = [
  {
    title: "Скругления, px",
    items: [
      { id: "radius", label: "Кнопки и поля", bb: 8, min: 0, max: 24 },
      { id: "islandRadius", label: "Остров", bb: 12, min: 0, max: 32 },
    ],
  },
  {
    title: "Отступы · шаг, px",
    items: [
      { id: "padStep", label: "Паддинги", hint: "Внутренние отступы кнопок, полей, панелей", bb: 4, min: 0, max: 12 },
      { id: "marginStep", label: "Марджины", hint: "Внешние отступы между блоками", bb: 4, min: 0, max: 12 },
      { id: "gapStep", label: "Гэпы", hint: "Промежутки между элементами в ряду и в столбце", bb: 4, min: 0, max: 12 },
      { id: "lip", label: "Поля вокруг острова", hint: "От края окна справа и снизу", bb: 4, min: 0, max: 32 },
    ],
  },
  {
    title: "Размеры, px",
    items: [
      { id: "sizeStep", label: "Шаг размеров", hint: "Кнопки, поля, иконки — всё, что bb меряет шагом 4 px", bb: 4, min: 2, max: 8 },
      { id: "chromeRow", label: "Верхний ряд", hint: "Высота шапки страницы и панелей", bb: 48, min: 32, max: 80 },
      { id: "listRow", label: "Строки списков", hint: "Треды, проекты и пункты меню", bb: 28, min: 20, max: 48 },
      { id: "fontSize", label: "Шрифт", hint: "Основной размер текста", bb: 13, min: 10, max: 20 },
    ],
  },
];

const COLOR_FIELDS: readonly ColorField[] = COLOR_GROUPS.flatMap((g) => g.items);
const COLOR_IDS: readonly ColorId[] = COLOR_FIELDS.map((f) => f.id);
const NUMBER_FIELDS: readonly NumberField[] = NUMBER_GROUPS.flatMap((g) => g.items);
const MODES: readonly Mode[] = ["light", "dark"];

/** Встроенные темы bb 0.46: их id занят. */
export const BUILT_IN_THEMES: readonly string[] = ["default", "nord", "dracula", "solarized", "gruvbox", "catppuccin"];

const HEX = /^#[0-9a-f]{6}$/iu;
const THEME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/u;

export const isHex = (value: unknown): value is string => typeof value === "string" && HEX.test(value);

export const numberField = (id: NumberId): NumberField => NUMBER_FIELDS.find((f) => f.id === id)!;

const sizeStepOf = (values: ThemeValues): number => values.sizeStep ?? numberField("sizeStep").bb;

/** Что действует в пустом поле: шаги отступов без своего значения идут за шагом размеров, остальное — значение bb. */
export function effectiveDefault(values: ThemeValues, field: NumberField): number {
  return SPACING_FAMILIES.some((f) => f.step === field.id) ? sizeStepOf(values) : field.bb;
}

export const inRange = (field: NumberField, value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= field.min && value <= field.max;

const record = (input: unknown): Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};

const hexOf = (value: unknown): string | null => (isHex(value) ? value.toLowerCase() : null);

const parsePalette = (input: unknown): Palette => {
  const source = record(input);
  return Object.fromEntries(COLOR_IDS.flatMap((id) => (hexOf(source[id]) ? [[id, hexOf(source[id])]] : [])));
};

/** Только допустимое: неизвестные ключи, hex не вида `#rrggbb` и числа вне пределов поля отбрасываются; hex — строчными. */
export function parseThemeValues(input: unknown): ThemeValues {
  const source = record(input);
  const palettes = MODES.flatMap((mode) => {
    const palette = parsePalette(source[mode]);
    return Object.keys(palette).length > 0 ? [[mode, palette]] : [];
  });
  const numbers = NUMBER_FIELDS.flatMap((f) => (inRange(f, source[f.id]) ? [[f.id, source[f.id]]] : []));
  const backdrop = hexOf(source.backdrop) ? [["backdrop", hexOf(source.backdrop)]] : [];
  return Object.fromEntries([...palettes, ...numbers, ...backdrop]) as ThemeValues;
}

/** Id темы bb из имени: латиница, цифры и дефис; занятое встроенной темой или пустое — null. */
export function themeId(name: string): string | null {
  const id = name.trim().toLowerCase().replace(/\s+/gu, "-");
  return THEME_ID.test(id) && !BUILT_IN_THEMES.includes(id) ? id : null;
}

export type CssTarget = "live" | "file";

/**
 * Селекторы блоков. Файл темы bb — `:root, .light` и `.dark`; живое применение
 * специфичнее блоков темы bb, чтобы перекрыть их, где бы bb ни положил свою тему.
 */
const SELECTORS: Readonly<Record<CssTarget, Readonly<Record<Mode | "root", string>>>> = {
  file: { light: ":root, .light", dark: ".dark", root: ":root" },
  live: { light: ":root:not(.dark)", dark: ":root.dark", root: "html:root" },
};

/** Числа, которые ложатся в переменную корня как есть, в px. */
const ROOT_VARS: readonly (readonly [NumberId, string])[] = [
  ["radius", "--radius"],
  ["sizeStep", "--spacing"],
  ["chromeRow", "--bb-app-chrome-row-height"],
  ["listRow", "--bb-sidebar-row-height"],
  ["fontSize", "--text-sm"],
  ["lip", "--wc-theme-lip"],
  ["islandRadius", "--wc-theme-island-radius"],
];

interface SpacingFamily {
  readonly step: NumberId;
  readonly variable: string;
  readonly negative: boolean;
  /** Класс утилиты bb → свойство CSS. */
  readonly classes: readonly (readonly [string, string])[];
}

/** Утилиты отступов bb (Tailwind 4): `.p-2{padding:calc(var(--spacing) * 2)}`. */
const SPACING_FAMILIES: readonly SpacingFamily[] = [
  {
    step: "padStep",
    variable: "--wc-pad",
    negative: false,
    classes: [
      ["p", "padding"],
      ["px", "padding-inline"],
      ["py", "padding-block"],
      ["pt", "padding-top"],
      ["pr", "padding-right"],
      ["pb", "padding-bottom"],
      ["pl", "padding-left"],
      ["ps", "padding-inline-start"],
      ["pe", "padding-inline-end"],
    ],
  },
  {
    step: "marginStep",
    variable: "--wc-margin",
    negative: true,
    classes: [
      ["m", "margin"],
      ["mx", "margin-inline"],
      ["my", "margin-block"],
      ["mt", "margin-top"],
      ["mr", "margin-right"],
      ["mb", "margin-bottom"],
      ["ml", "margin-left"],
      ["ms", "margin-inline-start"],
      ["me", "margin-inline-end"],
    ],
  },
  {
    step: "gapStep",
    variable: "--wc-gap-step",
    negative: false,
    classes: [
      ["gap", "gap"],
      ["gap-x", "column-gap"],
      ["gap-y", "row-gap"],
    ],
  },
];

/** Шаги утилит, которые встречаются в bb 0.46. */
export const SPACING_STEPS: readonly number[] = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24];

/**
 * Варианты утилит, которые действуют на десктопе. Свои правила темы идут в
 * слой утилит bb позже его собственных, поэтому базовый класс темы перебил бы
 * вариант bb той же специфичности — варианты повторяются, каждый в своём условии.
 */
const VARIANTS: readonly (readonly [string, string | null])[] = [
  ["", null],
  ["sm\\:", "@media (width >= 40rem)"],
  ["md\\:", "@media (width >= 48rem)"],
  ["max-md\\:", "@media (width < 48rem)"],
  ["\\@md\\:", "@container (width >= 28rem)"],
  ["pointer-fine\\:", "@media (pointer: fine)"],
];

const px = (value: number): string => `${value}px`;
const escapeStep = (step: number): string => String(step).replace(".", "\\.");

const block = (selector: string, declarations: readonly string[]): string =>
  `${selector} {\n${declarations.map((d) => `  ${d};`).join("\n")}\n}`;

const familyRules = (family: SpacingFamily, prefix: string): string[] =>
  family.classes.flatMap(([name, property]) =>
    SPACING_STEPS.flatMap((step) => {
      const positive = `.${prefix}${name}-${escapeStep(step)} { ${property}: calc(var(${family.variable}) * ${step}); }`;
      const negative = `.${prefix}-${name}-${escapeStep(step)} { ${property}: calc(var(${family.variable}) * -${step}); }`;
      return family.negative ? [positive, negative] : [positive];
    }),
  );

/** Семьи отступов, шаг которых владелец развёл с шагом размеров: остальные bb и так считает от `--spacing`. */
const splitFamilies = (values: ThemeValues): SpacingFamily[] => {
  const size = sizeStepOf(values);
  return SPACING_FAMILIES.filter((f) => values[f.step] !== undefined && values[f.step] !== size);
};

const spacingLayer = (families: readonly SpacingFamily[]): string => {
  const rules = VARIANTS.flatMap(([prefix, condition]) => {
    const body = families.flatMap((f) => familyRules(f, prefix));
    return condition === null ? body : [`${condition} {\n${body.join("\n")}\n}`];
  });
  return `@layer utilities {\n${rules.join("\n")}\n}`;
};

/** Таблица темы: только заданные поля; без значений — пустая строка. */
export function themeCss(values: ThemeValues, target: CssTarget): string {
  const selectors = SELECTORS[target];
  const palettes = MODES.flatMap((mode) => {
    const palette = values[mode] ?? {};
    const declarations = COLOR_FIELDS.flatMap(({ id, alsoSets = [] }) =>
      palette[id] ? [`--${id}`, ...alsoSets].map((variable) => `${variable}: ${palette[id]}`) : [],
    );
    return declarations.length > 0 ? [block(selectors[mode], declarations)] : [];
  });
  const families = splitFamilies(values);
  const root = [
    ...ROOT_VARS.flatMap(([id, variable]) => (values[id] === undefined ? [] : [`${variable}: ${px(values[id])}`])),
    ...(values.backdrop ? [`--wc-theme-backdrop: ${values.backdrop}`] : []),
    ...families.map((f) => `${f.variable}: ${px(values[f.step]!)}`),
  ];
  return [
    ...palettes,
    ...(root.length > 0 ? [block(selectors.root, root)] : []),
    ...(families.length > 0 ? [spacingLayer(families)] : []),
  ].join("\n");
}

const without = <T extends object>(source: T, key: keyof T): T =>
  Object.fromEntries(Object.entries(source).filter(([k]) => k !== key)) as T;

/** Цвет темы `mode`; `null` — вернуть цвет текущей темы bb. Пустая палитра уходит целиком. */
export function withColor(values: ThemeValues, mode: Mode, id: ColorId, hex: string | null): ThemeValues {
  const palette: Palette = hex === null ? without(values[mode] ?? {}, id) : { ...values[mode], [id]: hex.toLowerCase() };
  return Object.keys(palette).length > 0 ? { ...values, [mode]: palette } : without(values, mode);
}

/** Фон за островом; `null` — чёрный по умолчанию. */
export function withBackdrop(values: ThemeValues, hex: string | null): ThemeValues {
  return hex === null ? without(values, "backdrop") : { ...values, backdrop: hex.toLowerCase() };
}

/** Число поля; `null` — значение bb. */
export function withNumber(values: ThemeValues, id: NumberId, value: number | null): ThemeValues {
  return value === null ? without(values, id) : { ...values, [id]: value };
}
