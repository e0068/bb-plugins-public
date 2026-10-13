// Иконка, которую хранит проект, задача, лейбл, вариант поля или колонка: одна строка. Знак — имя подборки Hugeicons
// (линейная иконка, как её хранили до вкладок) или `ph:<имя>` знака Phosphor; `filled:` перед знаком — залитая иконка:
// Hugeicons на плашке, Phosphor своим залитым начертанием. После знака — цвета: `;c=<цвет>` линии и `;bg=<цвет>` плашки.
// Эмодзи — как есть, без цветов.
import { ICON_CATALOG } from "./catalog";
import { PHOSPHOR_FILL, PHOSPHOR_LINE } from "./phosphor";

/** Цвета, выбранные у самой иконки; чего нет — берётся у носителя. */
export interface IconColors {
  /** Цвет линии знака. */
  readonly color?: string;
  /** Цвет плашки под знаком; только у залитой. */
  readonly background?: string;
}

/** Набор знака: нет — Hugeicons, "phosphor" — Phosphor. */
export type IconSet = "phosphor";

export type Icon =
  | { readonly kind: "line"; readonly name: string; readonly set?: IconSet; readonly color?: string }
  | ({ readonly kind: "filled"; readonly name: string; readonly set?: IconSet } & IconColors)
  | { readonly kind: "emoji"; readonly char: string };

const FILLED = "filled:";
const PHOSPHOR = "ph:";
/** Самое длинное эмодзи подборки — семья из четырёх человек — 11 единиц UTF-16; 16 оставляют запас и отсекают строки. */
const EMOJI_MAX = 16;
/** Эмодзи — картинка без букв, цифр и пробелов: «1️⃣» и «🚀 rocket» эмодзи не считаются. */
const EMOJI = /^(?=.*[\p{Extended_Pictographic}\p{Regional_Indicator}])[^\p{L}\p{N}\s:]+$/u;
/** Цвет — имя CSS или #rgb…#rrggbbaa: ничего, что вышло бы за пределы атрибута fill. */
const COLOR = /^(?:[a-z]{3,20}|#[0-9a-f]{3,8})$/i;

/** Есть ли знак с этим именем в наборе и начертании. */
const known = (kind: "line" | "filled", set: IconSet | undefined, name: string): boolean =>
  set === undefined ? ICON_CATALOG.has(name) : (kind === "line" ? PHOSPHOR_LINE : PHOSPHOR_FILL).has(name);

/** Цвета хвоста `;c=…;bg=…`, или null, если хвост не такой. */
function colorsOf(options: readonly string[]): IconColors | null {
  const pairs = options.map((option) => option.split("="));
  const valid = pairs.every(([key, value, ...rest]) => (key === "c" || key === "bg") && value !== undefined && COLOR.test(value) && rest.length === 0);
  const keys = pairs.map(([key]) => key);
  if (!valid || new Set(keys).size !== keys.length) return null;
  const read = (key: string) => pairs.find(([own]) => own === key)?.[1];
  const color = read("c");
  const background = read("bg");
  return { ...(color === undefined ? {} : { color }), ...(background === undefined ? {} : { background }) };
}

/** Иконка, которую хранит строка, или null, если там не иконка: неизвестное имя, мусор, пусто. */
export function parseIcon(raw: string | undefined): Icon | null {
  if (raw === undefined) return null;
  const [glyph = "", ...options] = raw.split(";");
  const kind = glyph.startsWith(FILLED) ? "filled" : "line";
  const ref = kind === "filled" ? glyph.slice(FILLED.length) : glyph;
  const set: IconSet | undefined = ref.startsWith(PHOSPHOR) ? "phosphor" : undefined;
  const name = set === undefined ? ref : ref.slice(PHOSPHOR.length);
  if (known(kind, set, name)) {
    const colors = colorsOf(options);
    if (colors === null || (kind === "line" && colors.background !== undefined)) return null;
    return { kind, name, ...(set === undefined ? {} : { set }), ...colors };
  }
  return raw.length <= EMOJI_MAX && EMOJI.test(raw) ? { kind: "emoji", char: raw } : null;
}

/** Строка, которой иконка хранится. */
export function iconValue(icon: Icon): string {
  if (icon.kind === "emoji") return icon.char;
  const glyph = `${icon.kind === "filled" ? FILLED : ""}${icon.set === "phosphor" ? PHOSPHOR : ""}${icon.name}`;
  const background = icon.kind === "filled" ? icon.background : undefined;
  return [glyph, ...(icon.color === undefined ? [] : [`c=${icon.color}`]), ...(background === undefined ? [] : [`bg=${background}`])].join(";");
}
