import { stringify as stringifyYaml } from "yaml";
import { isPropertyName } from "../shared/properties.js";
import { LABELS_FIELD, tagsOf, tagsValue } from "../shared/section-fields.js";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * A section's record as Kasimov shows and saves it: its title, the section's
 * fields, its text and the two dates the database keeps — not the record as
 * it lies in the database, with the slug and key the board needs and no
 * fields until someone writes them (docs/specs/BBPL-901-…). The Tags every
 * section has are the record's labels: shown as `tags:` and saved back to them.
 */

export interface RecordDates {
  created: string;
  updated: string;
}

export type SectionWrite = { ok: true; text: string } | { ok: false };

/** An empty field is shown with no value, whether it was never written or written empty. */
const shownValue = (value: unknown): unknown => (value === "" || value === undefined ? null : value);

/** A field written with no value is kept empty, so the section does not lose it. */
const keptValue = (value: unknown): unknown => (value === null ? "" : value);

/** The record's own fields: every key of its frontmatter the board does not read. */
const ownFields = (data: Readonly<Record<string, unknown>>): [string, unknown][] => Object.entries(data).filter(([key]) => isPropertyName(key));

const documentOf = (frontmatter: Record<string, unknown>, body: string): string =>
  `---\n${stringifyYaml(frontmatter, { nullStr: "" }).trimEnd()}\n---\n\n${body.replace(/^(\r?\n)+/, "")}`;

const titleOf = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));

/** A YAML scalar as a name — YAML reads `2026` as a number — or "" for anything else. */
const nameOf = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");

/** The names a list of labels or a typed Tags value holds: each item of a YAML list as it is, or a line split by commas. */
const namesOf = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.map(nameOf).filter((name) => name !== ""))] : tagsOf(nameOf(value));

/** The record's own fields with its labels as the Tags — a list when a label holds a comma, so it is not split on the way back;
 *  a Tags value written before Tags were labels shows until labels replace it. */
const shownFields = (data: Readonly<Record<string, unknown>>): Map<string, unknown> => {
  const own = new Map(ownFields(data));
  const labels = namesOf(data.labels);
  if (labels.length > 0) own.set(LABELS_FIELD, labels.some((label) => label.includes(",")) ? labels : tagsValue(labels));
  return own;
};

/** The record as Kasimov shows it: the title, the section's fields in order, the record's other fields, then the dates when given. */
export function sectionText(stored: string, fields: readonly string[], dates: RecordDates | null): string {
  const { data, body } = parseFrontmatter(stored);
  const own = shownFields(data);
  const names = [...new Set([...fields, ...own.keys()])];
  return documentOf(
    {
      title: titleOf(data.title),
      ...Object.fromEntries(names.map((name) => [name, shownValue(own.get(name))])),
      ...(dates === null ? {} : { created: dates.created, updated: dates.updated }),
    },
    body,
  );
}

/**
 * The record to store for a text Kasimov saved: the title, fields and text of
 * the edit over the stored record's service keys. The dates and a task's
 * fields are not taken from the edit; fields that do not read are refused.
 */
export function sectionWrite(stored: string, edited: string): SectionWrite {
  const edit = parseFrontmatter(edited);
  if (edit.error !== undefined) return { ok: false };
  const service = Object.entries(parseFrontmatter(stored).data).filter(([key]) => !isPropertyName(key) && key !== "title" && key !== "labels");
  const labels = namesOf(edit.data[LABELS_FIELD]);
  return {
    ok: true,
    text: documentOf(
      {
        title: titleOf(edit.data.title),
        ...Object.fromEntries(service),
        ...(labels.length > 0 ? { labels } : {}),
        ...Object.fromEntries(ownFields(edit.data).filter(([name]) => name !== LABELS_FIELD).map(([name, value]) => [name, keptValue(value)])),
      },
      edit.body,
    ),
  };
}
