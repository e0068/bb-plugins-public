import { readFile, stat } from "node:fs/promises";
import { sep } from "node:path";
import type { FileTimes } from "./timestamps.js";

/**
 * Parsed task files, re-parsed only when the file changed. Every read still
 * asks the disk — a `stat` per file — so a request sees exactly what the
 * folder holds, as decisions/tasks-files-are-the-store.md requires; what it
 * skips is reading and parsing a file whose stat is the one already seen,
 * three quarters of a board read (spec
 * tasks-bystraya-zagruzka-doski-ruchnoi-poryadok-peretaskivani).
 */
export interface ParseCache {
  /** The file parsed by `parse`, or null when the disk will not hand it
   *  over. The same path must always come with the same `parse`. */
  read<T>(filePath: string, parse: (content: string, times: FileTimes) => T): Promise<T | null>;
  /** Forgets the files under `dir` a walk of it did not see — moved or
   *  deleted ones — so the cache holds only what is on disk. */
  keepOnly(dir: string, seen: ReadonlySet<string>): void;
}

interface Entry {
  /** What the file's stat looked like when it was parsed. */
  stamp: string;
  parsed: unknown;
}

/** Any write moves mtime or ctime; size catches a same-tick rewrite. */
const stampOf = (stats: { mtimeMs: number; ctimeMs: number; size: number }): string =>
  `${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}`;

export function createParseCache(): ParseCache {
  const entries = new Map<string, Entry>();
  return {
    async read<T>(filePath: string, parse: (content: string, times: FileTimes) => T): Promise<T | null> {
      const stats = await stat(filePath).catch(() => null);
      const known = entries.get(filePath);
      if (stats && known?.stamp === stampOf(stats)) return known.parsed as T;
      const content = stats && (await readFile(filePath, "utf8").catch(() => null));
      if (!stats || content === null) {
        entries.delete(filePath);
        return null;
      }
      const parsed = parse(content, stats);
      entries.set(filePath, { stamp: stampOf(stats), parsed });
      return parsed;
    },
    keepOnly(dir: string, seen: ReadonlySet<string>): void {
      const prefix = dir.endsWith(sep) ? dir : dir + sep;
      for (const path of [...entries.keys()]) {
        if (path.startsWith(prefix) && !seen.has(path)) entries.delete(path);
      }
    },
  };
}
