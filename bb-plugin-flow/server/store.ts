// Брифы и ответы в kv плагина. Запись читается через схему контракта: чужое
// или устаревшее значение — это отсутствие, а не падение вызова.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";

import type { Carried } from "../core/carry";
import {
  answerRecordSchema,
  awaitingEntrySchema,
  carriedSchema,
  decisionBriefSchema,
  dispatchPlaceSchema,
  dispatchRouteSchema,
  type AnswerRecord,
  type DecisionBrief,
  type DispatchPlace,
  type DispatchRoute,
} from "../shared/contract";

export const KV_VALUE_LIMIT_BYTES = 256 * 1024;

const briefKey = (id: string) => `decision:${id}`;
const answerKey = (id: string) => `decision-answer:${id}`;
const threadCarryKey = (threadId: string) => `decision-thread-carry:${threadId}`;
const launchedKey = (threadId: string) => `decision-launched:${threadId}`;
/** Место исполнения по проектам — одним значением: у настроек плагина нет попроектного разреза. */
const PLACES_KEY = "dispatch-place";

const placesSchema = z.record(z.string(), dispatchPlaceSchema);

/** Маршрут нового треда по проектам — рядом с местом, своим ключом: старая запись мест читается как была. */
const ROUTES_KEY = "dispatch-route";

const routesSchema = z.record(z.string(), dispatchRouteSchema);

/** Треды, ждущие владельца на брифе Flow, — одним значением: левая панель читает список целиком. */
const AWAITING_KEY = "flow-awaiting";

const awaitingSchema = z.record(z.string(), awaitingEntrySchema);

export type AwaitingEntry = z.output<typeof awaitingEntrySchema>;

export type DecisionStore = {
  putBrief(brief: DecisionBrief): Promise<{ kind: "stored" } | { kind: "too_large"; bytes: number }>;
  getBrief(id: string): Promise<DecisionBrief | null>;
  getAnswer(id: string): Promise<AnswerRecord | null>;
  putAnswer(
    id: string,
    record: AnswerRecord,
  ): Promise<{ kind: "stored"; record: AnswerRecord } | { kind: "already_answered"; record: AnswerRecord }>;
  /** Откат записи, когда реплика агенту так и не ушла. */
  dropAnswer(id: string): Promise<void>;
  /** Тред, созданный передачей работы: дописывается к уже записанному ответу. */
  attachHandoff(id: string, threadId: string): Promise<void>;
  /** Перенос последнего отвеченного брифа треда — целиком, пустой тоже: он заменяет прежний. */
  putThreadCarry(threadId: string, carried: Carried): Promise<void>;
  /** Перенос треда; нет записи или она чужая — пустой перенос. */
  getThreadCarry(threadId: string): Promise<Carried>;
  /** Работа треда уже отправлена на исполнение: этапы и бюджет в нём больше не спрашиваются. */
  isLaunched(threadId: string): Promise<boolean>;
  markLaunched(threadId: string): Promise<void>;
  /** Последний выбор места исполнения в проекте; нет записи или она чужая — «в этом треде». */
  getPlace(projectId: string): Promise<DispatchPlace>;
  putPlace(projectId: string, place: DispatchPlace): Promise<void>;
  /** Последний маршрут нового треда в проекте; нет записи или она чужая — `null`. */
  getRoute(projectId: string): Promise<DispatchRoute | null>;
  putRoute(projectId: string, route: DispatchRoute): Promise<void>;
  /** Тред ждёт владельца на брифе: новый бриф заменяет прежнее ожидание. */
  putAwaiting(threadId: string, entry: AwaitingEntry): Promise<void>;
  /** Ответ снимает ожидание только своего брифа: новее бриф того же треда ждёт дальше. */
  clearAwaiting(threadId: string, briefId: string): Promise<void>;
  listAwaiting(): Promise<Array<{ threadId: string } & AwaitingEntry>>;
  /** Удалённый тред больше ничего не ждёт. */
  dropAwaiting(threadId: string): Promise<void>;
};

export const createStore = (kv: PluginKvStorage): DecisionStore => {
  // kv не транзакционен: «прочитать и записать, если пусто» для одного брифа
  // выстраивается в очередь, иначе два нажатия успевают записать оба ответа.
  const queues = new Map<string, Promise<unknown>>();
  const serialized = <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const run = (queues.get(id) ?? Promise.resolve()).then(work, work);
    const settled = run.catch(() => undefined);
    queues.set(id, settled);
    void settled.then(() => {
      if (queues.get(id) === settled) queues.delete(id);
    });
    return run;
  };

  const readAwaiting = async () => {
    const parsed = awaitingSchema.safeParse(await kv.get(AWAITING_KEY));
    return parsed.success ? parsed.data : {};
  };

  const getAnswer = async (id: string) => {
    const parsed = answerRecordSchema.safeParse(await kv.get(answerKey(id)));
    return parsed.success ? parsed.data : null;
  };

  return {
    async putBrief(brief) {
      const bytes = Buffer.byteLength(JSON.stringify(brief), "utf8");
      if (bytes > KV_VALUE_LIMIT_BYTES) return { kind: "too_large", bytes };
      await kv.set(briefKey(brief.id), brief);
      return { kind: "stored" };
    },
    async getBrief(id) {
      const parsed = decisionBriefSchema.safeParse(await kv.get(briefKey(id)));
      return parsed.success ? parsed.data : null;
    },
    getAnswer,
    putAnswer: (id, record) =>
      serialized(id, async () => {
        const existing = await getAnswer(id);
        if (existing !== null) return { kind: "already_answered", record: existing };
        await kv.set(answerKey(id), record);
        return { kind: "stored", record };
      }),
    dropAnswer: (id) => serialized(id, () => kv.delete(answerKey(id))),
    attachHandoff: (id, threadId) =>
      serialized(id, async () => {
        const existing = await getAnswer(id);
        if (existing !== null) await kv.set(answerKey(id), { ...existing, handoffThreadId: threadId });
      }),
    async putThreadCarry(threadId, carried) {
      await kv.set(threadCarryKey(threadId), carried);
    },
    async getThreadCarry(threadId) {
      const parsed = carriedSchema.safeParse(await kv.get(threadCarryKey(threadId)));
      return parsed.success ? parsed.data : {};
    },
    async isLaunched(threadId) {
      return (await kv.get(launchedKey(threadId))) === true;
    },
    async markLaunched(threadId) {
      await kv.set(launchedKey(threadId), true);
    },
    async getPlace(projectId) {
      const parsed = placesSchema.safeParse(await kv.get(PLACES_KEY));
      return (parsed.success ? parsed.data[projectId] : undefined) ?? "here";
    },
    async putPlace(projectId, place) {
      const parsed = placesSchema.safeParse(await kv.get(PLACES_KEY));
      await kv.set(PLACES_KEY, { ...(parsed.success ? parsed.data : {}), [projectId]: place });
    },
    async getRoute(projectId) {
      const parsed = routesSchema.safeParse(await kv.get(ROUTES_KEY));
      return (parsed.success ? parsed.data[projectId] : undefined) ?? null;
    },
    async putRoute(projectId, route) {
      const parsed = routesSchema.safeParse(await kv.get(ROUTES_KEY));
      await kv.set(ROUTES_KEY, { ...(parsed.success ? parsed.data : {}), [projectId]: route });
    },
    putAwaiting: (threadId, entry) => serialized(AWAITING_KEY, async () => kv.set(AWAITING_KEY, { ...(await readAwaiting()), [threadId]: entry })),
    clearAwaiting: (threadId, briefId) =>
      serialized(AWAITING_KEY, async () => {
        const current = await readAwaiting();
        if (current[threadId]?.briefId !== briefId) return;
        const { [threadId]: _gone, ...rest } = current;
        await kv.set(AWAITING_KEY, rest);
      }),
    dropAwaiting: (threadId) =>
      serialized(AWAITING_KEY, async () => {
        const { [threadId]: _gone, ...rest } = await readAwaiting();
        await kv.set(AWAITING_KEY, rest);
      }),
    listAwaiting: async () => Object.entries(await readAwaiting()).map(([threadId, entry]) => ({ threadId, ...entry })),
  };
};
