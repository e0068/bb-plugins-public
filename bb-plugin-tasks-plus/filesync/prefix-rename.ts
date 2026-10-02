/**
 * What changing a board's key prefix does to its tasks, as pure functions:
 * which key each task gets, and how a text that names the old keys reads
 * after. No files, no database — filesync/store.ts writes the result.
 */

export interface KeyedTask {
  id: string;
  key: string;
  /** Null for a task the board has not named yet: its key is its slug, and the rename leaves it. */
  number: number | null;
}

type Numbered = KeyedTask & { number: number };

const byNumberThenKey = (a: Numbered, b: Numbered): number => a.number - b.number || a.key.localeCompare(b.key);

/** The board's prefix now, and the one it changes to. */
export interface PrefixChange {
  from: string;
  to: string;
}

/**
 * The key every numbered task of the board gets under the new prefix, by task
 * id. A task keeps its number. Two tasks can share a number — keys left under
 * an older prefix — and then the number goes first to a task that already has
 * the new key, so running the rename again changes nothing, then to one under
 * the board's current prefix; the other gets the next number above every
 * number on the board.
 */
export function rekeyBoard(tasks: readonly KeyedTask[], change: PrefixChange): Map<string, string> {
  const prefix = change.to;
  const numbered = tasks.filter((task): task is Numbered => task.number !== null);
  const prefixOf = (task: Numbered) => task.key.slice(0, task.key.lastIndexOf("-")).toUpperCase();
  const rank = (task: Numbered) => (prefixOf(task) === change.to ? 0 : prefixOf(task) === change.from ? 1 : 2);
  const ordered = [...numbered].sort((a, b) => rank(a) - rank(b) || byNumberThenKey(a, b));
  const firstFree = Math.max(0, ...numbered.map((task) => task.number)) + 1;
  const keys = new Map<string, string>();
  const taken = new Set<number>();
  const crowded: Numbered[] = [];
  for (const task of ordered) {
    if (taken.has(task.number)) crowded.push(task);
    else {
      taken.add(task.number);
      keys.set(task.id, `${prefix}-${task.number}`);
    }
  }
  crowded.forEach((task, index) => keys.set(task.id, `${prefix}-${firstFree + index}`));
  return keys;
}

/**
 * A whole key in prose: not part of a longer word, a path or a file name
 * (`docs/specs/SHA-12-foo.md` and `SHA-12.md` name files the rename does not
 * move), and in capitals, as the board issues keys — a lowercase slug is not
 * one. A key that ends a sentence is still one.
 */
const MENTION = /(?<![\w./-])[A-Z][A-Z0-9]{0,9}-\d+(?![\w-]|\.\w)/g;

/** The text with every key in `renames` (old → new) replaced, each mention once, so renames that chain do not run on. */
export function rewriteMentions(text: string, renames: ReadonlyMap<string, string>): string {
  return text.replace(MENTION, (key) => renames.get(key) ?? key);
}
