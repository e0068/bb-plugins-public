// Layer 1 — the plugin changelog's entry files, as the merge-time bump sees
// them: which files of a PR are entries, how an entry gets its version and
// date, and the entry a PR without one of its own gets from its title.
// Zero effects.
//
// An entry is its own file, `bb-plugin-<name>/changelog/<entry>.md`: a header
// between `---` lines with `version` (`coming-soon` until the bump stamps it),
// `date` and `pr` — the PR that released it — then the notes, each a `- ru:`
// line and an `  en:` line. One file per PR, never shared, so two PRs of one
// plugin have nothing to conflict on — see
// docs/decisions/changelog-entry-file-per-pr.md.
//
// `pr` is what lets a later bump of the same PR move its entries to another
// version while leaving every other entry alone — history files a PR adds
// carry no `pr` of theirs and are never restamped.

const PLUGIN_ROOT = /^bb-plugin-[^/]+$/;
const HEADER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const STAMPED_FIELD = /^(version|date|pr):/;
const COMING_SOON = "coming-soon";

/** What the bump writes into an entry's header: the version the plugin lands on, the merge moment, UTC to the minute (`YYYY-MM-DDTHH:MMZ`), the PR number. */
export interface EntryStamp {
  version: string;
  date: string;
  pull: number;
}

/** Whether a root keeps a changelog: plugins do, shared packages under packages/ do not. */
export function keepsChangelog(root: string): boolean {
  return PLUGIN_ROOT.test(root);
}

/** Whether a path lies in a plugin's changelog folder. */
export function isChangelogPath(path: string): boolean {
  return /^bb-plugin-[^/]+\/changelog\//.test(path);
}

/** The PR's paths that are entry files of `root` — `.md` files straight inside `<root>/changelog/`. */
export function changelogEntriesOf(root: string, paths: readonly string[]): string[] {
  const prefix = `${root}/changelog/`;
  return paths.filter((path) => path.startsWith(prefix) && /^[^/]+\.md$/.test(path.slice(prefix.length)));
}

/** Where the entry of a PR that wrote none of its own goes. */
export function fallbackEntryPath(root: string, pullNumber: number): string {
  return `${root}/changelog/pr-${pullNumber}.md`;
}

/** The header's lines, or null when the text has no header — then it is not an entry. */
function headerOf(text: string): { lines: string[]; match: RegExpExecArray } | null {
  const match = HEADER.exec(text);
  return match ? { lines: match[1]!.split(/\r?\n/), match } : null;
}

const fieldOf = (lines: readonly string[], name: string): string | null =>
  lines.map((line) => new RegExp(`^${name}:\\s*(.*?)\\s*$`).exec(line)?.[1]).find((value) => value !== undefined) ?? null;

/** Whether the bump of PR `pull` may stamp this entry: it is still coming-soon, or this very PR stamped it. */
export function belongsToPull(text: string, pull: number): boolean {
  const header = headerOf(text);
  return header !== null && (fieldOf(header.lines, "version") === COMING_SOON || fieldOf(header.lines, "pr") === String(pull));
}

const stampLines = ({ version, date, pull }: EntryStamp): string[] => [`version: ${version}`, `date: ${date}`, `pr: ${pull}`];

/**
 * The entry with the stamp set, first in its header; every other header
 * line and the whole body stay as they were. Null when the text has no
 * header — it is not an entry, and guessing one would bury the notes.
 */
export function stampEntry(text: string, stamp: EntryStamp): string | null {
  const header = headerOf(text);
  if (!header) return null;
  const kept = header.lines.filter((line) => line.trim() !== "" && !STAMPED_FIELD.test(line));
  return `---\n${[...stampLines(stamp), ...kept].join("\n")}\n---${header.match[2]}${text.slice(header.match[0].length)}`;
}

/** The entry of a PR without one of its own: its title, on one line, in both languages. Null for a blank title. */
export function fallbackEntry(title: string, stamp: EntryStamp): string | null {
  const line = title.replace(/\s+/g, " ").trim();
  return line === "" ? null : `---\n${stampLines(stamp).join("\n")}\n---\n\n- ru: ${line}\n  en: ${line}\n`;
}
