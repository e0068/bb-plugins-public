// Слой 1 — чисто. Конфликты, которые шаг догоняния ветки сводит сам: файл
// задачи и пункт ченж-лога. Правило сведения известно заранее, поэтому здесь
// только тексты на входе и текст на выходе; git — у wiring/catch-up.ts.
//
// Файл задачи правят и доска в main (ключ, поля владельца), и агент в ветке
// (перенос в другую папку, тело, комментарии). `docs/tasks/** merge=union`
// склеивает правки содержимого сам, конфликтом остаётся перенос против правки:
// git не узнаёт перенесённый и переписанный файл и видит «удалён у нас,
// изменён у них». Сведение — по правилу task-flow: папка из ветки (кроме
// отмены в main), поля владельца и доски из main, тело из ветки, комментарии
// обеих сторон.
//
// Пункт ченж-лога — файл на PR, но тред, продолжающий работу после влитого
// PR, дописывает тот же файл, которому Bump в main уже проставил версию.
// Проставленный файл — история, его не переписывают: новые пункты уходят
// в новый файл с `coming-soon`.

/** Вид конфликта по коду `git status --porcelain`. */
export type UnmergedKind = "both-modified" | "both-added" | "deleted-by-us" | "deleted-by-them" | "added-by-us" | "added-by-them" | "both-deleted";

export type Unmerged = { path: string; kind: UnmergedKind };

const KINDS: Readonly<Record<string, UnmergedKind>> = {
  UU: "both-modified",
  AA: "both-added",
  DU: "deleted-by-us",
  UD: "deleted-by-them",
  AU: "added-by-us",
  UA: "added-by-them",
  DD: "both-deleted",
};

/** Файлы, которые слияние оставило в конфликте, из вывода `git status --porcelain`; прочие строки пропускаются. */
export const parseUnmerged = (porcelain: string): Unmerged[] =>
  porcelain.split("\n").flatMap((line) => {
    const kind = KINDS[line.slice(0, 2)];
    return kind === undefined ? [] : [{ path: line.slice(3).trim(), kind }];
  });

export type ConflictClass = "task" | "changelog" | "other";

const TASK_PATH = /^docs\/tasks\/[^/]+\/[^/]+\.md$/;
const CHANGELOG_PATH = /^bb-plugin-[^/]+\/changelog\/[^/]+\.md$/;

/** Чей конфликт шаг сводит сам: файл задачи, пункт ченж-лога; остальное — работа агента. */
export const conflictClass = (path: string): ConflictClass => (TASK_PATH.test(path) ? "task" : CHANGELOG_PATH.test(path) ? "changelog" : "other");

/** Папка и слаг файла задачи по пути `docs/tasks/<папка>/<слаг>.md`. */
export const taskPathParts = (path: string): { folder: string; slug: string } | null => {
  const match = /^docs\/tasks\/([^/]+)\/([^/]+)\.md$/.exec(path);
  return match === null ? null : { folder: match[1]!, slug: match[2]! };
};

/** Папка сведённой задачи: из ветки, кроме отмены в main — отменённую задачу ветка не воскрешает. */
export const taskFolder = ({ oursFolder, theirsFolder }: { oursFolder: string; theirsFolder: string }): string => (theirsFolder === "canceled" ? theirsFolder : oursFolder);

/** Поля, которые правит владелец на доске или выдаёт сама доска: в сведённом файле они из main. */
const MAIN_FIELDS: ReadonlySet<string> = new Set(["title", "priority", "due", "labels", "parent", "key", "epic"]);

type HeaderEntry = { key: string; lines: string[] };

/** Шапка — записи «ключ: значение» с вложенными строками под ними (`taken_by:` с отступом). */
const headerEntries = (header: string): HeaderEntry[] =>
  header.split("\n").reduce<HeaderEntry[]>((entries, line) => {
    const key = /^([A-Za-z_][\w-]*):/.exec(line)?.[1];
    if (key !== undefined) return [...entries, { key, lines: [line] }];
    const last = entries[entries.length - 1];
    return last === undefined ? entries : [...entries.slice(0, -1), { ...last, lines: [...last.lines, line] }];
  }, []);

/** Первое вхождение каждого ключа: union склеивает обе стороны шапки, и ключи повторяются. */
const firstOfEach = (entries: readonly HeaderEntry[]): HeaderEntry[] => entries.filter((entry, at) => entries.findIndex((other) => other.key === entry.key) === at);

type TaskParts = { header: string; body: string; comments: string[] };

const COMMENTS = "## Comments";
const COMMENT_MARK = /^<!-- comment id="([^"]+)"[^>]*?at="([^"]*)"/;

/** Шапка, тело и комментарии — каждый с маркером и текстом до следующего маркера. */
const taskParts = (text: string): TaskParts => {
  const header = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const rest = header === null ? text : text.slice(header[0].length);
  const at = rest.indexOf(`\n${COMMENTS}`);
  const body = at < 0 ? rest : rest.slice(0, at);
  const journal = at < 0 ? "" : rest.slice(at + COMMENTS.length + 1);
  const comments = journal
    .split(/\n(?=<!-- comment id=")/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => COMMENT_MARK.test(chunk));
  return { header: header?.[1] ?? "", body: body.trim(), comments };
};

const commentId = (comment: string): string => COMMENT_MARK.exec(comment)?.[1] ?? "";
const commentAt = (comment: string): string => COMMENT_MARK.exec(comment)?.[2] ?? "";

/** Две копии одной задачи — ветки и main — в одну по правилу task-flow. */
export const mergeTaskFile = ({ ours, theirs }: { ours: string; theirs: string }): string => {
  const mine = taskParts(ours);
  const main = taskParts(theirs);
  const mainEntries = firstOfEach(headerEntries(main.header));
  const fromMain = (entry: HeaderEntry) => (MAIN_FIELDS.has(entry.key) ? (mainEntries.find((other) => other.key === entry.key) ?? entry) : entry);
  const kept = firstOfEach(headerEntries(mine.header)).map(fromMain);
  const added = mainEntries.filter((entry) => MAIN_FIELDS.has(entry.key) && !kept.some((other) => other.key === entry.key));
  const header = [...kept, ...added].flatMap((entry) => entry.lines).join("\n");
  const comments = [...mine.comments, ...main.comments]
    .filter((comment, at, all) => all.findIndex((other) => commentId(other) === commentId(comment)) === at)
    .sort((left, right) => commentAt(left).localeCompare(commentAt(right)));
  return `---\n${header}\n---\n\n${mine.body}\n\n${COMMENTS}\n${comments.map((comment) => `\n${comment}\n`).join("")}`;
};

const COMING_SOON = "coming-soon";

type Entry = { header: string; items: string[] };

/** Шапка пункта ченж-лога и его заметки: строка `- ru:` вместе со строками под ней. */
const entryParts = (text: string): Entry => {
  const header = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const rest = header === null ? text : text.slice(header[0].length);
  const items = rest
    .split(/\n(?=- )/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("- "));
  return { header: header?.[1] ?? "", items };
};

const stamped = (entry: Entry): boolean => !new RegExp(`^version:\\s*${COMING_SOON}\\s*$`, "m").test(entry.header);

const entryText = (header: string, items: readonly string[]): string => `---\n${header}\n---\n\n${items.join("\n")}\n`;

/**
 * Две стороны одного пункта ченж-лога. `keep` — что остаётся под путём файла,
 * `extra` — новый файл с `coming-soon` для заметок, которым под проставленной
 * версией не место; `null` — новых заметок нет.
 */
export const mergeChangelog = ({ base, ours, theirs }: { base: string | null; ours: string; theirs: string }): { keep: string; extra: string | null } => {
  const mine = entryParts(ours);
  const main = entryParts(theirs);
  const old = base === null ? [] : entryParts(base).items;
  if (!stamped(mine) && !stamped(main)) return { keep: entryText(mine.header, [...new Set([...mine.items, ...main.items])]), extra: null };
  // История — проставленная сторона, её файл остаётся как есть; при двух проставленных — main, его версия уже вышла.
  const [history, other, kept] = stamped(main) ? [main, mine, theirs] : [mine, main, ours];
  const fresh = other.items.filter((item) => !history.items.includes(item) && !old.includes(item));
  return { keep: kept, extra: fresh.length === 0 ? null : entryText(`version: ${COMING_SOON}`, fresh) };
};
