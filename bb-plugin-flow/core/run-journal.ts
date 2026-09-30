// Файлы журнала, которые прогон оставил в дереве треда: по одному на каждый
// отвеченный за время прогона бриф. Путь, записанный при ответе, идёт как есть;
// файл, который записать не вышло, в журнал не входит; у ответов, данных до того,
// как путь стали запоминать, он выводится тем же правилом, что и при записи: имя
// из названия брифа, повтор названия в треде — суффиксом по порядку ответов.
import { decisionFileName, suffixedName } from "./journal-doc";

/**
 * Отвеченный бриф треда. `path` — файл журнала, записанный при ответе; `null` — записать не вышло;
 * поля нет — ответ дан до того, как путь стали запоминать, и путь выводится.
 */
export type JournalEntry = { briefId: string; title: string; answeredAt: string; path?: string | null };

export type RunWindow = { startedAt: string; finishedAt: string };

const inWindow = ({ startedAt, finishedAt }: RunWindow) => (at: string): boolean => {
  const time = Date.parse(at);
  return time >= Date.parse(startedAt) && time <= Date.parse(finishedAt);
};

/** Пути от корня дерева треда, по порядку ответов; ответы вне окна имя занимают, но в журнал прогона не входят. */
export const runJournal = (entries: readonly JournalEntry[], window: RunWindow, dir: string): string[] => {
  const ordered = [...entries].sort((a, b) => Date.parse(a.answeredAt) - Date.parse(b.answeredAt));
  const named = ordered.reduce<{ taken: ReadonlyMap<string, number>; files: ReadonlyArray<{ at: string; path: string | null }> }>(
    ({ taken, files }, { title, answeredAt, path }) => {
      const base = decisionFileName(title);
      const attempt = taken.get(base) ?? 0;
      return {
        taken: new Map(taken).set(base, attempt + 1),
        files: [...files, { at: answeredAt, path: path === undefined ? `${dir}/${suffixedName(base, attempt)}.md` : path }],
      };
    },
    { taken: new Map(), files: [] },
  );
  return named.files.flatMap(({ at, path }) => (path !== null && inWindow(window)(at) ? [path] : []));
};
