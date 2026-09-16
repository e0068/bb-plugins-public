import { parse as parseYaml } from "yaml";

export interface ParsedFrontmatter {
  /** Parsed YAML key/values from the leading `---` block ({} when absent or
   * unreadable — see `error`). */
  data: Record<string, unknown>;
  /** Everything after the frontmatter block (the markdown body). */
  body: string;
  /**
   * Set when a `---` block is present but does not parse to a key/value
   * mapping (thrown YAML error, or a scalar/array/null). Absent when there is
   * no `---` block at all (a plain markdown file — that is valid, not an
   * error) or when the block parsed cleanly. Kept for callers that want to
   * say why a file's fields came back empty; the task reader does not
   * reject the file over it (see
   * decisions/tasks-every-file-in-a-status-folder-is-a-task.md).
   */
  error?: string;
}

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/**
 * Splits a markdown document into its leading YAML frontmatter and body.
 * A document without a `---` block yields empty data and the whole content as
 * body — that is a valid, frontmatter-less file. A document that *has* a
 * `---` block but fails to parse (bad YAML, or YAML that parses to something
 * other than a mapping) yields empty data plus `error`, the parser's reason.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = FRONTMATTER.exec(content);
  if (!match) return { data: {}, body: content };
  const body = content.slice(match[0].length);
  try {
    // `uniqueKeys: false`: a union-merged file (the repo's .gitattributes
    // keeps task files under `merge=union`) can carry a key twice when both
    // sides of a merge touched it — last one wins rather than the file's
    // whole frontmatter going empty over it; the next board write
    // normalises the file.
    const parsed: unknown = parseYaml(match[1] ?? "", { uniqueKeys: false });
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { data: {}, body, error: "frontmatter is not a key/value mapping" };
    }
    return { data: parsed as Record<string, unknown>, body };
  } catch (err) {
    return { data: {}, body, error: err instanceof Error ? err.message : String(err) };
  }
}
