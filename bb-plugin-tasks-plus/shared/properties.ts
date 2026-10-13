/**
 * A record's own properties: the frontmatter keys of its file that the board
 * does not model, holding a scalar — text, a number, yes or no. They are
 * shown and written as text. Lists and nested blocks are not properties and
 * are never touched, and neither is any key the board reads itself. See
 * docs/specs/tasks-svoi-polya-zapisi-iz-frontmatter-setka-svoistva-v-kart.md.
 */

/** Every frontmatter key the board or a plugin beside it reads or writes. */
export const BOARD_KEYS: ReadonlySet<string> = new Set([
  "title",
  "slug",
  "id",
  "key",
  "type",
  "priority",
  "estimate",
  "minutes",
  "minutes_actual",
  "budget",
  "limit",
  "cost",
  "cost_actual",
  "due",
  "start",
  "labels",
  "icon",
  "parent",
  "taken_by",
  "threads",
  "attachments",
  "flow",
  "created",
  "updated",
  "tokens",
  "checks",
  "ts",
  "status",
  "assignee",
  "epic",
]);

export type Properties = Readonly<Record<string, string>>;

const scalarText = (value: unknown): string | null =>
  typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : null;

/** A name a property can take: not blank, no surrounding spaces, not a board key. */
export const isPropertyName = (name: string): boolean => name.trim() === name && name !== "" && !BOARD_KEYS.has(name);

const isProperty = (key: string, value: unknown): boolean => isPropertyName(key) && scalarText(value) !== null;

/** The properties a file's frontmatter holds, by name, in the file's order. */
export function propertiesOf(frontmatter: Readonly<Record<string, unknown>>): Properties {
  return Object.fromEntries(
    Object.entries(frontmatter).flatMap(([key, value]) => {
      const text = scalarText(value);
      return isPropertyName(key) && text !== null ? [[key, text]] : [];
    }),
  );
}

/**
 * A change to a record's properties: names to set to a value, names to take
 * away, and names to rename (old → new). A patch, not the whole set, so two
 * edits made close together — or on two machines — both land.
 */
export interface PropertyPatch {
  set?: Readonly<Record<string, string>>;
  remove?: readonly string[];
  rename?: Readonly<Record<string, string>>;
}

/**
 * The frontmatter with `patch` applied to its properties: a renamed one keeps
 * its place, a set one takes the text, a new one comes last, a removed one
 * goes. A property the patch does not name keeps its value as it was — a
 * number stays a number. Board keys, lists and blocks are never touched; a
 * name that cannot be a property, or a rename onto a name already taken, is
 * left out.
 */
export function patchProperties(frontmatter: Readonly<Record<string, unknown>>, patch: PropertyPatch): Record<string, unknown> {
  const set = Object.entries(patch.set ?? {}).filter(([name]) => isPropertyName(name));
  const values = new Map(set);
  const removed = new Set(patch.remove ?? []);
  const taken = new Set(Object.keys(frontmatter));
  const renamed = (key: string): string => {
    const to = patch.rename?.[key];
    return to !== undefined && isPropertyName(to) && (to === key || !taken.has(to)) ? to : key;
  };
  const kept = Object.entries(frontmatter).flatMap(([key, value]): [string, unknown][] => {
    if (!isProperty(key, value)) return [[key, value]];
    if (removed.has(key)) return [];
    const name = renamed(key);
    return [[name, values.has(name) ? values.get(name) : value]];
  });
  const known = new Set(kept.map(([key]) => key));
  return Object.fromEntries([...kept, ...set.filter(([name]) => !known.has(name) && !taken.has(name))]);
}
