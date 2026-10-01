// Слой 1 — чисто. Текст брифа блоками: агент пишет абзацы и многоуровневые
// списки markdown — `-`, `*` или `1.` в начале строки, вложенность отступом в
// два пробела. Ссылки внутри строк режет `textParts`, здесь только строки.

export type ListItem = { text: string; children: Block[] };

export type Block = { kind: "paragraph"; text: string } | { kind: "list"; ordered: boolean; items: ListItem[] };

type Line = { kind: "item"; level: number; ordered: boolean; text: string } | { kind: "text"; indented: boolean; text: string } | { kind: "blank" };

const MARKER = /^([-*]|\d+[.)])\s+(.*)$/;

const INDENT_STEP = 2;

const lineOf = (raw: string): Line => {
  const expanded = raw.replace(/\t/g, " ".repeat(INDENT_STEP));
  const body = expanded.trimStart();
  if (body === "") return { kind: "blank" };
  const indent = expanded.length - body.length;
  const marker = MARKER.exec(body.trimEnd());
  return marker === null
    ? { kind: "text", indented: indent > 0, text: body.trimEnd() }
    : { kind: "item", level: Math.floor(indent / INDENT_STEP), ordered: /\d/.test(marker[1]!), text: marker[2]! };
};

const joined = (a: string, b: string): string => (a === "" ? b : `${a} ${b}`);

/**
 * Список с первой строки `start`: его пункты — строки глубже `parent` и не глубже первой, глубже первой — вложенный список
 * последнего пункта, строка с отступом без маркера — продолжение последнего пункта. Возвращает список и первую строку после него.
 */
const listAt = (lines: readonly Line[], start: number, parent: number): { block: Block; next: number } => {
  const first = lines[start] as Extract<Line, { kind: "item" }>;
  const items: ListItem[] = [];
  const withLast = (update: (item: ListItem) => ListItem) => items.splice(items.length - 1, 1, update(items[items.length - 1]!));
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "item" && line.level > parent && line.level <= first.level) {
      items.push({ text: line.text, children: [] });
      i += 1;
    } else if (line.kind === "item" && line.level > first.level) {
      const nested = listAt(lines, i, first.level);
      withLast((last) => ({ ...last, children: [...last.children, nested.block] }));
      i = nested.next;
    } else if (line.kind === "text" && line.indented) {
      withLast((last) => ({ ...last, text: joined(last.text, line.text) }));
      i += 1;
    } else break;
  }
  return { block: { kind: "list", ordered: first.ordered, items }, next: i };
};

/** Абзацы и списки по порядку; текст без маркеров и переводов строк — ровно один абзац. */
export const textBlocks = (text: string): Block[] => {
  const lines = text.split("\n").map(lineOf);
  const blocks: Block[] = [];
  let paragraph = "";
  let i = 0;
  const flush = () => {
    if (paragraph !== "") blocks.push({ kind: "paragraph", text: paragraph });
    paragraph = "";
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "item") {
      flush();
      const list = listAt(lines, i, -1);
      blocks.push(list.block);
      i = list.next;
    } else {
      if (line.kind === "blank") flush();
      else paragraph = joined(paragraph, line.text);
      i += 1;
    }
  }
  flush();
  return blocks;
};
