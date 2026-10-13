import { LABEL_COLOR } from "../shared/enums.js";

/**
 * A board's own labels: the names added in Manage → Labels with their
 * colours. A task carries a label by name (its `labels:` list), so a label
 * no task carries yet lives only here, and a name a task carries that is
 * missing here is still a label, drawn grey.
 */
export interface CatalogLabel {
  readonly name: string;
  readonly color: string;
}

/** The catalog with `name` in `color`: an existing name is recoloured in place, a new one goes last. */
export const withLabel = (catalog: readonly CatalogLabel[], name: string, color: string): CatalogLabel[] =>
  catalog.some((label) => label.name === name)
    ? catalog.map((label) => (label.name === name ? { name, color } : label))
    : [...catalog, { name, color }];

/** The catalog without `name`. */
export const withoutLabel = (catalog: readonly CatalogLabel[], name: string): CatalogLabel[] =>
  catalog.filter((label) => label.name !== name);

/** The catalog with `from` renamed in place, in `color` or else the colour it had — or, for a name
 *  it does not hold, the colour `to` already has; another entry named `to` is folded into it. */
export function renamedLabel(catalog: readonly CatalogLabel[], from: string, to: string, color?: string): CatalogLabel[] {
  const listed = catalog.find((label) => label.name === from);
  if (listed === undefined) return withLabel(catalog, to, color ?? labelColor(catalog, to));
  const kept = to === from ? catalog : withoutLabel(catalog, to);
  return kept.map((label) => (label.name === from ? { name: to, color: color ?? listed.color } : label));
}

/** The board's labels: the catalog in its order, then the names tasks carry that it lacks. */
export function boardLabelList(catalog: readonly CatalogLabel[], carried: Iterable<string>): CatalogLabel[] {
  const known = new Set(catalog.map((label) => label.name));
  const extra = [...new Set(carried)].filter((name) => !known.has(name)).map((name) => ({ name, color: LABEL_COLOR }));
  return [...catalog, ...extra];
}

/** The colour the board draws `name` in. */
export const labelColor = (catalog: readonly CatalogLabel[], name: string): string =>
  catalog.find((label) => label.name === name)?.color ?? LABEL_COLOR;
