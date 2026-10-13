import { isPropertyName } from "./properties.js";

/**
 * The fields of a section's records. A field has a name and a type; the
 * section's list of them lives in its database, so every machine on it draws
 * the same columns. Every section starts with Tags and Date; a key any record
 * has in its frontmatter and the list does not name is a text field too, so a
 * key typed in Kasimov shows up as a column. The title and the text are the
 * record's own, not fields; the values stay text in the frontmatter whatever
 * the type — a Select holds one of its options, Tags several joined by commas
 * (docs/specs/BBPL-901-tasks-zapis-tablicy-otkryvaetsya-kasimovym.md).
 */

export const FIELD_TYPES = ["text", "number", "select", "tags", "date", "checkbox", "url"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** The types a value of is picked from the field's options. */
export const CHOICE_TYPES: ReadonlySet<FieldType> = new Set(["select", "tags"]);

export interface SectionField {
  readonly name: string;
  readonly type: FieldType;
  /** The options a Select or Tags value is picked from, in the order they were added. */
  readonly options?: string[];
}

/** The Tags every section starts with: the record's labels, not a value of its own — picked, shown and
 *  saved the way a task's labels are, and named so in Kasimov. */
export const LABELS_FIELD = "tags";

export const DEFAULT_FIELDS: readonly SectionField[] = [
  { name: LABELS_FIELD, type: "tags" },
  { name: "date", type: "date" },
];

/** A record's value of the field named `name`, as text: its labels joined for the Tags every section has. */
export const recordValue = (
  record: { readonly properties?: Readonly<Record<string, string>>; readonly labelIds: readonly string[] },
  name: string,
): string => (name === LABELS_FIELD ? tagsValue(record.labelIds) : (record.properties?.[name] ?? ""));

/** The tags a Tags value holds: its comma-separated parts, trimmed, each once. */
export const tagsOf = (value: string): string[] => [
  ...new Set(
    value
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ""),
  ),
];

/** The value that holds `tags`. */
export const tagsValue = (tags: readonly string[]): string => tags.join(", ");

/** The options in a stored list, each once in any case. */
const parseOptions = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((option: unknown): string[] => {
    if (typeof option !== "string" || optionProblem([], option) !== null || seen.has(option.toLowerCase())) return [];
    seen.add(option.toLowerCase());
    return [option];
  });
};

const isFieldType = (value: unknown): value is FieldType => (FIELD_TYPES as readonly unknown[]).includes(value);

/** The fields a stored list holds: entries that cannot be a field are left out, and a name already seen —
 *  in any case, as two machines adding "Size" and "size" at once would leave it — keeps its first type. */
export function parseFields(raw: unknown): SectionField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((entry: unknown): SectionField[] => {
    if (entry === null || typeof entry !== "object") return [];
    const { name, type, options } = entry as Record<string, unknown>;
    if (typeof name !== "string" || !isPropertyName(name) || !isFieldType(type) || seen.has(name.toLowerCase())) return [];
    seen.add(name.toLowerCase());
    return [CHOICE_TYPES.has(type) ? { name, type, options: parseOptions(options) } : { name, type }];
  });
}

/** The fields a section's list declares, laid over the defaults: a declared default keeps the default's type
 *  and brings the options it was declared with. */
const withDefaults = (declared: readonly SectionField[]): SectionField[] => {
  const own = parseFields(declared);
  const sameName = (a: SectionField) => (b: SectionField) => a.name.toLowerCase() === b.name.toLowerCase();
  const defaults = DEFAULT_FIELDS.map((field) => {
    const options = own.find(sameName(field))?.options;
    return options === undefined || !CHOICE_TYPES.has(field.type) ? field : { ...field, options };
  });
  return [...defaults, ...own.filter((field) => !DEFAULT_FIELDS.some(sameName(field)))];
};

/** The fields of a section: the defaults, the ones its list declares in the order they were added,
 *  then every other key its records have, alphabetically, as text — each name once. */
export function sectionFields(
  declared: readonly SectionField[],
  records: readonly { properties?: Readonly<Record<string, string>> }[],
): SectionField[] {
  const listed = withDefaults(declared);
  const named = new Set(listed.map((field) => field.name));
  const loose = [...new Set(records.flatMap((record) => Object.keys(record.properties ?? {})))]
    .filter((name) => !named.has(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name): SectionField => ({ name, type: "text" }));
  return [...listed, ...loose];
}

/** Why a section that declares `declared` cannot take a field named `name`, or null when it can. A key records
 *  have without declaring it can be declared — that is how it gets a type. */
export function fieldProblem(declared: readonly SectionField[], name: string): string | null {
  const fields = withDefaults(declared);
  if (name.trim() === "") return "A property needs a name.";
  if (name.trim() !== name) return "A name cannot start or end with a space.";
  if (!isPropertyName(name)) return `“${name}” is taken by the record itself.`;
  if (fields.some((field) => field.name.toLowerCase() === name.toLowerCase())) return `The section already has “${name}”.`;
  return null;
}

/** The field of a section named `name`, declared or a default, or undefined. */
export const declaredField = (declared: readonly SectionField[], name: string): SectionField | undefined =>
  withDefaults(declared).find((field) => field.name === name);

/** Why `option` cannot join the options `options`, or null when it can. A comma would split a Tags value. */
export function optionProblem(options: readonly string[], option: string): string | null {
  if (option.trim() === "") return "An option needs a name.";
  if (option.trim() !== option) return "An option cannot start or end with a space.";
  if (option.includes(",")) return "An option cannot hold a comma.";
  if (options.some((taken) => taken.toLowerCase() === option.toLowerCase())) return `“${option}” is already an option.`;
  return null;
}
