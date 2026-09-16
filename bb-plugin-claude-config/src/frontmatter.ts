// Parsing and assembling YAML frontmatter for markdown files (skills,
// agents, memory). A pure layer with no I/O: DocTab shows fields as a table
// and edits them, and serialization returns the file byte-for-byte when
// there are no edits.

// A frontmatter block entry: either a top-level `key: value` field, or a
// line we didn't touch (a comment, the indent of a nested value, blank) —
// kept verbatim for an exact round-trip.
export type FrontmatterEntry =
  | { kind: "field"; key: string; value: string }
  | { kind: "raw"; text: string };

export type ParsedFrontmatter = {
  hasFrontmatter: boolean;
  entries: FrontmatterEntry[];
  body: string;
};

// A field line: a key from the start of the line (no indent), a colon, then
// the value after a single space/tab. Indentation or no space → not a
// top-level field (a nested value or `key:value`), keep it as raw.
const FIELD_RE = /^([A-Za-z0-9_][A-Za-z0-9_-]*):(?:[ \t](.*))?$/;

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split("\n");
  if (lines[0] !== "---") {
    return { hasFrontmatter: false, entries: [], body: content };
  }
  // Closing delimiter — the first "---" line after the opening one.
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    return { hasFrontmatter: false, entries: [], body: content };
  }
  const entries: FrontmatterEntry[] = lines.slice(1, end).map((line) => {
    const match = FIELD_RE.exec(line);
    return match
      ? { kind: "field", key: match[1], value: match[2] ?? "" }
      : { kind: "raw", text: line };
  });
  const body = lines.slice(end + 1).join("\n");
  return { hasFrontmatter: true, entries, body };
}

export function serializeFrontmatter(
  entries: FrontmatterEntry[],
  body: string,
): string {
  const block = entries.map((entry) =>
    entry.kind === "field"
      ? entry.value === ""
        ? `${entry.key}:`
        : `${entry.key}: ${entry.value}`
      : entry.text,
  );
  return ["---", ...block, "---", body].join("\n");
}

// Replaces the value of the i-th field — pure, returns a new array (for setState).
export function setFieldValue(
  entries: FrontmatterEntry[],
  index: number,
  value: string,
): FrontmatterEntry[] {
  return entries.map((entry, i) =>
    i === index && entry.kind === "field" ? { ...entry, value } : entry,
  );
}
