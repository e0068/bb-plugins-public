import { parseFrontmatter } from "./frontmatter.js";
import { mapFrontmatter, statusFromFolder } from "./map.js";
import { sha256, type ScannedFile } from "./sync.js";

/**
 * Minimal filesystem view the scanner needs, so the real bb.sdk-backed reader
 * and the test fake share one contract. Paths are repo-relative.
 */
export interface FileReader {
  /** Recursive repo-relative paths under `folder` (files only is fine). */
  listPaths(folder: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
}

/** A `.md` file whose leading `---` block does not parse to a key/value
 * mapping. Excluded from the scan's `files`, kept out of `syncProjectFiles`'s
 * matching entirely — see decisions/tasks-frontmatter-strict-invalid.md. */
export interface InvalidFile {
  /** Repo-relative path of the offending file. */
  filePath: string;
  /** Parser's reason, from `ParsedFrontmatter.error`. */
  reason: string;
}

export interface ScanResult {
  files: ScannedFile[];
  invalid: InvalidFile[];
}

/**
 * Reads `<folder>/<status>/<name>.md` files and maps each to a task. The
 * immediate subfolder is the status; files not two levels deep, not `.md`, or
 * under an unknown status folder are skipped. One unreadable file is skipped
 * rather than failing the whole scan.
 *
 * A file whose frontmatter block fails to parse (see
 * `parseFrontmatter`/`ParsedFrontmatter.error`) is INVALID: it is left out of
 * `files` entirely — never mapped, never silently defaulted to `data: {}` —
 * and reported in `invalid` with its path and the parser's reason instead.
 * Callers must keep such a file's existing task untouched rather than delete
 * it (see `SyncOptions.invalidFilePaths` in filesync/sync.ts).
 */
export async function scanTaskFolder(
  reader: FileReader,
  folder: string,
): Promise<ScanResult> {
  const root = folder.replace(/\/+$/, "");
  const paths = await reader.listPaths(root);
  const files: ScannedFile[] = [];
  const invalid: InvalidFile[] = [];
  for (const path of paths) {
    if (!path.endsWith(".md")) continue;
    const rel = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
    if (rel === null) continue;
    const segments = rel.split("/");
    if (segments.length < 2) continue; // require <status>/<file>.md under root
    const status = statusFromFolder(segments[0] ?? "");
    if (status === null) continue;
    let content: string;
    try {
      content = await reader.readFile(path);
    } catch {
      continue;
    }
    const filename = (segments[segments.length - 1] ?? "").replace(/\.md$/, "");
    const { data, body, error } = parseFrontmatter(content);
    if (error !== undefined) {
      invalid.push({ filePath: path, reason: error });
      continue;
    }
    const mapped = mapFrontmatter(data, status, filename, body);
    files.push({ mapped, filePath: path, contentSha: sha256(JSON.stringify(mapped)) });
  }
  return { files, invalid };
}
