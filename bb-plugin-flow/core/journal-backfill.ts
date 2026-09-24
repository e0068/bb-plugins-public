// Восстановление журнала из хранилища плагина: те же файлы, что написал бы
// journal-writer, если бы запись работала. Чистое ядро — ни базы, ни диска.
import type { Locale } from "../lib/i18n";
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { decisionDocument, decisionFileName, suffixedName } from "./journal-doc";

export type BackfillRecord = { brief: DecisionBrief; answer: DecisionAnswer; decidedAt: string };

export type BackfillFile = { name: string; content: string };

/** Первое свободное имя ряда `base`, `base-2`, `base-3`, … — тот же ряд, которым живая запись разводит столкновения. */
const freeName = (base: string, taken: ReadonlySet<string>): string => {
  for (let attempt = 0; ; attempt += 1) {
    const name = `${suffixedName(base, attempt)}.md`;
    if (!taken.has(name)) return name;
  }
};

/**
 * Записи в файлы: порядок — по времени ответа, имя — из заголовка брифа.
 * `existing` — что в каталоге уже лежит. Файл с тем же содержимым пропускается:
 * восстановление той же записи второй раз не заводит копию с суффиксом. Занятое
 * имя при другом содержимом разводится тем же рядом, что и живая запись, —
 * поверх чужого файла скрипт не пишет никогда.
 */
export const backfillFiles = (records: readonly BackfillRecord[], locale?: Locale, existing: readonly BackfillFile[] = []): BackfillFile[] =>
  [...records]
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
    .reduce<{ names: ReadonlySet<string>; contents: ReadonlySet<string>; files: BackfillFile[] }>(
      (acc, { brief, answer, decidedAt }) => {
        const content = decisionDocument({ brief, answer, decidedAt, locale });
        if (acc.contents.has(content)) return acc;
        const name = freeName(decisionFileName(brief.title), acc.names);
        return {
          names: new Set([...acc.names, name]),
          contents: new Set([...acc.contents, content]),
          files: [...acc.files, { name, content }],
        };
      },
      { names: new Set(existing.map((f) => f.name)), contents: new Set(existing.map((f) => f.content)), files: [] },
    ).files;
