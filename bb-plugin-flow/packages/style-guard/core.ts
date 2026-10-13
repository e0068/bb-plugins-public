// Сторож своих стилей — чистые функции без файловой системы. Плагин берёт готовые компоненты и не пишет стили сам:
// инлайн-стиль, тег style, блок CSS, произвольное значение Tailwind в квадратных скобках и самодельные кнопка и поле
// ввода — нарушения. Нынешние нарушения плагина записаны списком «файл → правило → сколько»: больше записанного —
// новое нарушение, меньше — запись пора уменьшить, так список только сокращается. Номера строк в список не пишутся:
// любая правка выше их сдвигает.

export type StyleRule = "inline-style" | "style-tag" | "raw-control" | "arbitrary-value" | "css-rule";

export const STYLE_RULES: readonly StyleRule[] = ["inline-style", "style-tag", "raw-control", "arbitrary-value", "css-rule"];

export interface SourceFile {
  readonly path: string;
  readonly source: string;
}

export interface Violation {
  readonly path: string;
  /** С единицы. */
  readonly line: number;
  readonly rule: StyleRule;
  /** Совпавший фрагмент строки. */
  readonly text: string;
}

/** Нынешние нарушения: файл → правило → число. */
export type Baseline = Readonly<Record<string, Readonly<Partial<Record<StyleRule, number>>>>>;

/** Нарушений по файлу и правилу больше записанного — все они, раз неизвестно, какое из них новое. */
export interface Excess {
  readonly path: string;
  readonly rule: StyleRule;
  readonly allowed: number;
  readonly found: readonly Violation[];
}

/** Нарушений меньше записанного: запись пора уменьшить до `count`. */
export interface Stale {
  readonly path: string;
  readonly rule: StyleRule;
  readonly allowed: number;
  readonly count: number;
}

export interface Comparison {
  readonly added: readonly Excess[];
  readonly stale: readonly Stale[];
}

type Pattern = readonly [StyleRule, RegExp];

const MARKUP: readonly Pattern[] = [
  ["inline-style", /\bstyle=\{/g],
  ["style-tag", /<style[\s>]/g],
  ["raw-control", /<(?:button|input|select|textarea)(?=[\s>/]|$)/g],
];

// Значение (`w-[13px]`, `bg-[#fff]`), свойство (`[field-sizing:content]`) и вариант (`[&_svg]:size-4`) Tailwind.
const CLASSES: readonly Pattern[] = [["arbitrary-value", /(?<![\w$.])(?:[\w-]+:)*!?-?[a-z][\w-]*-\[[^\]\s'"`]+\]|(?<![\w$])\[[a-z&][^\]\s'"`]*?[:_][^\]\s'"`]*\]/g]];

const CSS: readonly Pattern[] = [["css-rule", /\{/g]];

const patternsFor = (path: string): readonly Pattern[] =>
  path.endsWith(".css") ? CSS : path.endsWith(".tsx") ? [...MARKUP, ...CLASSES] : path.endsWith(".ts") ? CLASSES : [];

// Комментарий — строка, которая начинается с `//`, `/*` или `*`: в нём пример нарушения нарушением не считается.
const isComment = (line: string): boolean => /^\s*(?:\/\/|\/\*|\*)/.test(line);

/** Свои стили и самодельные контролы в файле: по правилам его расширения, построчно, без комментариев. */
export const styleViolations = ({ path, source }: SourceFile): Violation[] => {
  const patterns = patternsFor(path);
  return source.split("\n").flatMap((text, index) =>
    isComment(text)
      ? []
      : patterns.flatMap(([rule, pattern]) => [...text.matchAll(pattern)].map((match): Violation => ({ path, line: index + 1, rule, text: match[0] }))),
  );
};

const key = (path: string, rule: StyleRule): string => `${path}\u0000${rule}`;

const groups = (found: readonly Violation[]): ReadonlyMap<string, readonly Violation[]> =>
  found.reduce((map, v) => new Map(map).set(key(v.path, v.rule), [...(map.get(key(v.path, v.rule)) ?? []), v]), new Map<string, readonly Violation[]>());

/** Список нынешних нарушений по находкам — снимок, с которого сторож начинает. */
export const baselineOf = (found: readonly Violation[]): Baseline =>
  found.reduce<Record<string, Partial<Record<StyleRule, number>>>>(
    (acc, v) => ({ ...acc, [v.path]: { ...acc[v.path], [v.rule]: (acc[v.path]?.[v.rule] ?? 0) + 1 } }),
    {},
  );

const entries = (baseline: Baseline): ReadonlyArray<readonly [string, StyleRule, number]> =>
  Object.entries(baseline).flatMap(([path, counts]) => STYLE_RULES.flatMap((rule) => (counts[rule] === undefined ? [] : [[path, rule, counts[rule]] as const])));

/** Находки против списка: где нарушений больше записанного и где запись пора уменьшить. */
export const compareBaseline = (found: readonly Violation[], baseline: Baseline): Comparison => {
  const byKey = groups(found);
  const allowedOf = (path: string, rule: StyleRule): number => baseline[path]?.[rule] ?? 0;
  const added = [...byKey.values()]
    .map((list): Excess => ({ path: list[0]!.path, rule: list[0]!.rule, allowed: allowedOf(list[0]!.path, list[0]!.rule), found: list }))
    .filter((excess) => excess.found.length > excess.allowed);
  const stale = entries(baseline)
    .map(([path, rule, allowed]): Stale => ({ path, rule, allowed, count: byKey.get(key(path, rule))?.length ?? 0 }))
    .filter((entry) => entry.count < entry.allowed);
  return { added, stale };
};

/** Текст падения: что заменить готовым компонентом и какие записи уменьшить; без расхождений — пустая строка. */
export const formatReport = ({ added, stale }: Comparison): string =>
  [
    ...(added.length === 0 ? [] : ["Свои стили или самодельные контролы сверх списка — замени готовым компонентом:"]),
    ...added.flatMap((excess) => [
      `  ${excess.path} ${excess.rule}: записано ${excess.allowed}, найдено ${excess.found.length}`,
      ...excess.found.map((v) => `    ${v.path}:${v.line} ${v.rule} ${v.text}`),
    ]),
    ...(stale.length === 0 ? [] : ["Нарушений меньше записанного — уменьши число в списке:"]),
    ...stale.map((entry) => `  ${entry.path} ${entry.rule}: ${entry.allowed} → ${entry.count}`),
  ].join("\n");
