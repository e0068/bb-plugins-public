// Отвеченные брифы каждого треда — сырьё журнала прогона (core/run-journal.ts).
// Новый ответ дописывается сюда вместе с путём файла, который записал журнал;
// ответы, данные раньше, один раз на все треды собираются из брифов: читать все
// брифы на каждый показ итога — мегабайты на запрос.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";

import type { JournalEntry } from "../core/run-journal";
import type { DecisionStore } from "./store";

const INDEX_PREFIX = "journal-index:";
const BUILT_KEY = "journal-index-built";

const entriesSchema = z.array(z.object({ briefId: z.string(), title: z.string(), answeredAt: z.string(), path: z.string().nullable().optional() }));

export type JournalIndex = {
  /** Ответ на бриф треда; повтор того же брифа заменяет прежнюю запись. */
  record(threadId: string, entry: JournalEntry): Promise<void>;
  /** Отвеченные брифы треда по времени ответа. */
  entries(threadId: string): Promise<JournalEntry[]>;
};

/** Записанное при ответе важнее собранного: у него есть путь файла. Порядок — по времени ответа. */
const merged = (kept: readonly JournalEntry[], added: readonly JournalEntry[]): JournalEntry[] =>
  [...kept, ...added.filter(({ briefId }) => !kept.some((entry) => entry.briefId === briefId))].sort((a, b) => Date.parse(a.answeredAt) - Date.parse(b.answeredAt));

export const createJournalIndex = (kv: PluginKvStorage, store: Pick<DecisionStore, "briefIds" | "getBrief" | "getAnswer">): JournalIndex => {
  // kv не транзакционен: «прочитать и дописать» по одному ключу идёт очередью.
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  };

  const read = async (threadId: string): Promise<JournalEntry[]> => {
    const parsed = entriesSchema.safeParse(await kv.get(`${INDEX_PREFIX}${threadId}`));
    return parsed.success ? parsed.data : [];
  };
  const write = (threadId: string, entries: readonly JournalEntry[]) => kv.set(`${INDEX_PREFIX}${threadId}`, entries);

  /** Все отвеченные брифы, сгруппированные по тредам. Уточнение журнала не пишет — его здесь нет. */
  const collect = async (): Promise<ReadonlyMap<string, JournalEntry[]>> => {
    const found = await Promise.all(
      (await store.briefIds()).map(async (id) => {
        const [brief, answer] = await Promise.all([store.getBrief(id), store.getAnswer(id)]);
        return brief === null || answer === null || brief.kind !== "brief" ? null : { threadId: brief.threadId, entry: { briefId: id, title: brief.title, answeredAt: answer.answeredAt } };
      }),
    );
    return found.reduce(
      (byThread, item) => (item === null ? byThread : byThread.set(item.threadId, [...(byThread.get(item.threadId) ?? []), item.entry])),
      new Map<string, JournalEntry[]>(),
    );
  };

  const build = async () => {
    if ((await kv.get(BUILT_KEY)) === true) return;
    const byThread = await collect();
    await Promise.all([...byThread].map(async ([threadId, entries]) => write(threadId, merged(await read(threadId), entries))));
    await kv.set(BUILT_KEY, true);
  };

  // Сборка одна на жизнь плагина: показы итогов ждут её, а не выстраиваются в очередь каждый. Сорвалась — следующий показ пробует снова.
  let built: Promise<void> | null = null;
  const ensureBuilt = (): Promise<void> => {
    built ??= serialized(build).catch((error: unknown) => {
      built = null;
      throw error;
    });
    return built;
  };

  return {
    record: (threadId, entry) => serialized(async () => write(threadId, merged([entry], await read(threadId)))),
    entries: async (threadId) => {
      await ensureBuilt();
      return read(threadId);
    },
  };
};
