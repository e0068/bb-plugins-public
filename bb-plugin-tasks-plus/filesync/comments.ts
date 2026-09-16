import type { Comment } from "../db/types.js";

/**
 * Parses the "## Comments" section of a task file into comment records.
 * Each comment is preceded by an HTML comment marker:
 *   <!-- comment id="…" kind="user|agent|system" author="…" [preset="…"] [thread="…"] at="…" -->
 * 
 * Markers are invisible in markdown rendering. Malformed markers are skipped.
 * Body text follows each marker until the next marker or end of section.
 */
export function parseComments(text: string): Comment[] {
  const MARKER = /<!--\s*comment\s+(.*?)-->/g;
  const matches = Array.from(text.matchAll(MARKER));
  const results: Comment[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const attrs = match[1] ?? "";
    
    // Body is from end of this marker to start of next marker (or end of text)
    const bodyStart = match.index! + match[0].length;
    const bodyEnd = i + 1 < matches.length ? matches[i + 1]!.index : text.length;
    const body = text.slice(bodyStart, bodyEnd).trim();
    
    // Parse attribute pairs: id="…" kind="…" etc.
    const parsed = new Map<string, string>();
    const attrRe = /(\w+)="([^"]*)"/g;
    for (const [, key, val] of attrs.matchAll(attrRe)) {
      parsed.set(key, val);
    }

    const id = parsed.get("id");
    const kind = parsed.get("kind") as "user" | "agent" | "system" | undefined;
    const authorName = parsed.get("author");
    const presetName = parsed.get("preset") || null;
    const threadId = parsed.get("thread") || null;
    const createdAt = parsed.get("at");

    if (id && kind && authorName && createdAt) {
      results.push({
        id,
        taskId: "", // set by caller
        kind,
        authorName,
        presetName,
        threadId,
        body,
        notifiedCount: 0,
        createdAt,
      });
    }
  }

  return results;
}

/**
 * Renders an array of comments into a "## Comments" section with markers.
 * Returns empty string if comments array is empty.
 */
export function renderComments(comments: readonly Comment[]): string {
  if (comments.length === 0) return "";
  
  let section = "## Comments\n\n";
  for (const c of comments) {
    let marker = `<!-- comment id="${c.id}" kind="${c.kind}" author="${c.authorName}"`;
    if (c.presetName) marker += ` preset="${c.presetName}"`;
    if (c.threadId) marker += ` thread="${c.threadId}"`;
    marker += ` at="${c.createdAt}" -->\n`;
    
    section += marker + c.body + "\n\n";
  }
  
  return section;
}
