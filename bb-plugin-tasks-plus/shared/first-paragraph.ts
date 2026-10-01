/**
 * The first paragraph of a markdown description as plain text: what a board
 * card shows under the title. Headings, code fences, HTML comments and rules
 * carry no prose, so they are passed over; inline markup is stripped.
 */

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const COMMENT = /<!--[\s\S]*?-->/g;
const BLOCK_PREFIX = /^\s*(>\s?)*\s*([-*+]|\d+[.)])?\s+/;

const INLINE: readonly (readonly [RegExp, string])[] = [
  [/\[\[([^\]]+)\]\]/g, "$1"],
  [/!\[([^\]]*)\]\([^)]*\)/g, "$1"],
  [/\[([^\]]*)\]\([^)]*\)/g, "$1"],
  [/`([^`]*)`/g, "$1"],
  [/\*\*(.+?)\*\*/g, "$1"],
  [/\*(.+?)\*/g, "$1"],
  // Underscores only at word edges: snake_case stays whole.
  [/(^|\W)__(.+?)__(?!\w)/g, "$1$2"],
  [/(^|\W)_(.+?)_(?!\w)/g, "$1$2"],
];

const stripInline = (text: string): string =>
  INLINE.reduce((stripped, [pattern, replacement]) => stripped.replace(pattern, replacement), text);

/** Lines outside code fences, comments removed. */
function proseLines(markdown: string): string[] {
  const withoutComments = markdown.replace(COMMENT, "");
  return withoutComments.split("\n").reduce<{ inFence: boolean; lines: string[] }>(
    (state, line) =>
      FENCE.test(line)
        ? { inFence: !state.inFence, lines: state.inFence ? state.lines : [...state.lines, ""] }
        : state.inFence
          ? state
          : { inFence: false, lines: [...state.lines, line] },
    { inFence: false, lines: [] },
  ).lines;
}

const isProse = (line: string): boolean => line.trim() !== "" && !HEADING.test(line) && !RULE.test(line);

export function firstParagraph(markdown: string): string {
  const lines = proseLines(markdown);
  const start = lines.findIndex(isProse);
  if (start === -1) return "";
  const rest = lines.slice(start);
  const end = rest.findIndex((line) => !isProse(line));
  // Joined before stripping: emphasis spans the paragraph, not a line.
  const paragraph = (end === -1 ? rest : rest.slice(0, end))
    .map((line) => line.replace(BLOCK_PREFIX, "").trim())
    .filter((line) => line !== "")
    .join(" ");
  return stripInline(paragraph);
}
