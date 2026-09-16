// Слой 1 — таблица кнопок панели форматирования и то, во что каждая кнопка
// превращает выделенный текст. Ни DOM, ни SDK: чистые данные и одна функция.
//
// ICON и FMT скопированы дословно из Касимова
// (editor/md-editor/md-editor.js), потому что панель обязана быть его: тот же
// порядок кнопок, те же глифы, те же обёртки, те же хоткеи в подсказках.
// Сборка packages/kasimov их не экспортирует — экспорт из самого Касимова
// снял бы копию, см. задачу в memory/tasks.

const svgIcon = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICON: Readonly<Record<string, string>> = {
  code: svgIcon(`<polyline points="8 8 4 12 8 16"/><polyline points="16 8 20 12 16 16"/>`),
  codeblock: svgIcon(`<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="9.5 10 7.5 12 9.5 14"/><polyline points="14.5 10 16.5 12 14.5 14"/>`),
  link: svgIcon(`<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>`),
  bullet: svgIcon(`<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none"/>`),
  numbered: svgIcon(`<line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="2" y="8.5" font-size="7" font-family="sans-serif" fill="currentColor" stroke="none">1</text><text x="2" y="20" font-size="7" font-family="sans-serif" fill="currentColor" stroke="none">2</text>`),
  quote: svgIcon(`<line x1="5" y1="5" x2="5" y2="19" stroke-width="2.5"/><line x1="9" y1="8" x2="19" y2="8"/><line x1="9" y1="12" x2="19" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>`),
  table: svgIcon(`<rect x="4" y="4" width="16" height="16" rx="1.5"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="12" y1="4" x2="12" y2="20"/>`),
};

/** Кнопка панели: глиф `l` или `icon`, обёртка `b`…`a`, `pre` — префикс строки. */
export type FmtButton = {
  readonly l?: string;
  readonly icon?: string;
  readonly cls?: string;
  readonly b?: string;
  readonly a?: string;
  readonly pre?: 1;
  readonly key: string;
  readonly name: string;
  readonly hot?: string;
};

/** Разделитель между группами кнопок. */
export type FmtSeparator = { readonly sep: 1 };

export type FmtRow = FmtButton | FmtSeparator;

export const isSeparator = (row: FmtRow): row is FmtSeparator => "sep" in row;

export const FMT: readonly FmtRow[] = [
  { l: "B", cls: "alpha bold", b: "**", a: "**", key: "bold", name: "Bold", hot: "⌘B" },
  { l: "I", cls: "alpha italic", b: "*", a: "*", key: "italic", name: "Italic", hot: "⌘I" },
  { l: "U", cls: "alpha underline", b: "++", a: "++", key: "underline", name: "Underline", hot: "⌘U" },
  { l: "S", cls: "alpha strike", b: "~~", a: "~~", key: "strike", name: "Strikethrough", hot: "⌘⇧S" },
  { sep: 1 },
  { l: "H1", cls: "hd hd1", b: "# ", a: "", pre: 1, key: "h1", name: "Heading 1" },
  { l: "H2", cls: "hd hd2", b: "## ", a: "", pre: 1, key: "h2", name: "Heading 2" },
  { l: "H3", cls: "hd hd3", b: "### ", a: "", pre: 1, key: "h3", name: "Heading 3" },
  { sep: 1 },
  { icon: "bullet", b: "- ", a: "", pre: 1, key: "bullet", name: "Bullet list" },
  { icon: "numbered", b: "1. ", a: "", pre: 1, key: "number", name: "Numbered list" },
  { icon: "quote", b: "> ", a: "", pre: 1, key: "quote", name: "Quote" },
  { sep: 1 },
  { icon: "code", b: "`", a: "`", key: "code", name: "Code", hot: "⌘⇧C" },
  { icon: "codeblock", key: "codeblock", name: "Code block", hot: "⇧⌘⌥C" },
  { sep: 1 },
  { icon: "link", cls: "sm", b: "[", a: "](url)", key: "link", name: "Link", hot: "⌘K" },
  { icon: "table", key: "table", name: "Insert table" },
];

// Заготовка таблицы Касимова (tables.js, insertStarterTable): выделенные слова
// становятся заголовками колонок, иначе две колонки «Column»; ширина маркера —
// NEW_COL_W = MIN_COL_W * 2 = 6 дефисов; ниже одна пустая строка данных.
const NEW_COL_W = 6;

function starterTable(selection: string): string {
  const words = selection.trim().split(/\s+/).filter((w) => w !== "");
  const cols = words.length ? words.map((w) => w.replace(/\|/g, "\\|")) : ["Column", "Column"];
  const dash = "-".repeat(NEW_COL_W);
  return [
    `| ${cols.join(" | ")} |`,
    `| ${cols.map(() => dash).join(" | ")} |`,
    `| ${cols.map(() => "").join(" | ")} |`,
  ].join("\n");
}

/**
 * Во что кнопка превращает выделенный текст. Ровно та же семантика, что у
 * `_applyFmt` в Касимове, только над строкой, а не над его DOM: строчная
 * кнопка оборачивает выделение, `pre` ставит префикс каждой задетой строке.
 */
export function applyFmt(selection: string, button: FmtButton): string {
  if (button.key === "table") return starterTable(selection);
  if (button.key === "codeblock") return "```\n" + selection + "\n```";
  if (button.pre) {
    return selection.split("\n").map((line) => (button.b ?? "") + line).join("\n");
  }
  return (button.b ?? "") + selection + (button.a ?? "");
}
