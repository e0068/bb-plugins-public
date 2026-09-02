// Layer 1 — parsing CLAUDE.md's @-imports and resolving them to absolute
// paths. No I/O at all: input is text and already-known paths, output is strings.

import { dirname, isAbsolute, join, normalize } from "node:path";

/**
 * Finds `@path` in the text of a markdown file (CLAUDE.md and similar). A
 * token counts as an import only if `@` is preceded by the start of the
 * line or whitespace (otherwise it's part of an email like
 * `user@example.com`) and the captured path looks like a file. Lines inside
 * fenced ``` code blocks aren't parsed. Order is first-occurrence, exact
 * duplicates are collapsed.
 */
export function parseImports(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  let inFence = false;

  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const pattern = /(?:^|\s)@(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const path = trimTrailingPunctuation(match[1]);
      if (path === "" || !looksLikePath(path) || seen.has(path)) continue;
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}

/** Trims trailing punctuation left over from the end of a sentence. */
function trimTrailingPunctuation(value: string): string {
  return value.replace(/[)(.,;:]+$/, "");
}

/** The path looks like a file: has a slash, has an extension, or starts with ~/./../. */
function looksLikePath(value: string): boolean {
  if (value.includes("/")) return true;
  if (/\.[a-z0-9]+$/i.test(value)) return true;
  if (value.startsWith("~") || value.startsWith("./") || value.startsWith("../")) {
    return true;
  }
  return false;
}

/**
 * Resolves an import path to an absolute one. `~` (or `~/...`) — relative
 * to the home directory; an absolute path — as-is; a relative one —
 * relative to the directory of the file where the import was found.
 */
export function resolveImportPath(
  fromFileAbs: string,
  importPath: string,
  home: string,
): string {
  if (importPath === "~" || importPath.startsWith("~/")) {
    const rest = importPath === "~" ? "" : importPath.slice(2);
    return normalize(join(home, rest));
  }
  if (isAbsolute(importPath)) return normalize(importPath);
  return normalize(join(dirname(fromFileAbs), importPath));
}
