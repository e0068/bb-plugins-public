// Брифы и ответы в kv плагина. Запись читается через схему контракта: чужое
// или устаревшее значение — это отсутствие, а не падение вызова.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";

import type { Carried } from "../core/carry";
import {
  addSchema,
  answerRecordSchema,
  awaitingEntrySchema,
  carriedSchema,
  decisionBriefSchema,
  dispatchRouteSchema,
  type Add,
  briefDraftSchema,
  type AnswerRecord,
  type DecisionBrief,
  type DispatchRoute,
} from "../shared/contract";

export const KV_VALUE_LIMIT_BYTES = 256 * 1024;

const BRIEF_PREFIX = "decision:";
const briefKey = (id: string) => `${BRIEF_PREFIX}${id}`;
const answerKey = (id: string) => `decision-answer:${id}`;
const threadCarryKey = (threadId: string) => `decision-thread-carry:${threadId}`;
const draftKey = (id: string) => `decision-draft:${id}`;
const returnedKey = (id: string) => `decision-returned:${id}`;
const threadReturnedKey = (threadId: string) => `decision-thread-returned:${threadId}`;
const threadCriteriaKey = (threadId: string): string => `thread-criteria:${threadId}`;

const criteriaListSchema = z.array(z.string());

const threadScopeKey = (threadId: string): string => `thread-scope:${threadId}`;
const launchedKey = (threadId: string) => `decision-launched:${threadId}`;
/** Маршрут нового треда по проектам. Места рядом нет: бриф всегда открывается «в этом треде». */
const ROUTES_KEY = "dispatch-route";

const routesSchema = z.record(z.string(), dispatchRouteSchema);

/** Треды, ждущие владельца на брифе Flow, — одним значением: левая панель читает список целиком. */
const AWAITING_KEY = "flow-awaiting";

const awaitingSchema = z.record(z.string(), awaitingEntrySchema);

export type AwaitingEntry = z.output<typeof awaitingEntrySchema>;

export type DecisionStore = {
  putBrief(brief: DecisionBrief): Promise<{ kind: "stored" } | { kind: "too_large"; bytes: number }>;
  getBrief(id: string): Promise<DecisionBrief | null>;
  /** Id всех брифов хранилища. */
  briefIds(): Promise<string[]>;
  getAnswer(id: string): Promise<AnswerRecord | null>;
  putAnswer(
    id: string,
    record: AnswerRecord,
  ): Promise<{ kind: "stored"; record: AnswerRecord } | { kind: "already_answered"; record: AnswerRecord }>;
  /** Откат записи, когда реплика агенту так и не ушла. */
  dropAnswer(id: string): Promise<void>;
  /** Тред, созданный передачей работы: дописывается к уже записанному ответу. */
  attachHandoff(id: string, threadId: string): Promise<void>;
  /** Черновик ответа владельца, пока бриф не отправлен; новый заменяет прежний. */
  putDraft(id: string, draft: string): Promise<void>;
  getDraft(id: string): Promise<string | null>;
  /** Отвеченному и забранному новым брифом черновик не нужен. */
  dropDraft(id: string): Promise<void>;
  /** Бриф вернулся агенту: владелец написал в чат, не отправив его. */
  markReturned(id: string): Promise<void>;
  isReturned(id: string): Promise<boolean>;
  /** Последний возвращённый бриф треда — до нового брифа, который его заберёт. */
  putThreadReturned(threadId: string, briefId: string): Promise<void>;
  getThreadReturned(threadId: string): Promise<string | null>;
  /** Новый бриф забрал возвращённый: второй его уже не получит. Указатель на другой бриф не трогается. */
  clearThreadReturned(threadId: string, briefId: string): Promise<void>;
  /** Перенос последнего отвеченного брифа треда — целиком, пустой тоже: он заменяет прежний. */
  putThreadCarry(threadId: string, carried: Carried): Promise<void>;
  /** Перенос треда; нет записи или она чужая — пустой перенос. */
  getThreadCarry(threadId: string): Promise<Carried>;
  /** Утверждённое «Готово, когда» треда — итог последнего ответа с пунктами; пустой список запись снимает. */
  putThreadCriteria(threadId: string, items: readonly string[]): Promise<void>;
  getThreadCriteria(threadId: string): Promise<string[]>;
  /** Утверждённый объём треда — цена, от которой считает бриф без своих пунктов. */
  putThreadScope(threadId: string, scope: Add): Promise<void>;
  getThreadScope(threadId: string): Promise<Add | null>;
  /** Работа треда уже отправлена на исполнение: этапы и бюджет в нём больше не спрашиваются. */
  isLaunched(threadId: string): Promise<boolean>;
  markLaunched(threadId: string): Promise<void>;
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
    async briefIds() {
      return (await kv.list(BRIEF_PREFIX)).filter((key) => key.startsWith(BRIEF_PREFIX)).map((key) => key.slice(BRIEF_PREFIX.length));
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
    async putDraft(id, draft) {
      await kv.set(draftKey(id), draft);
    },
    async getDraft(id) {
      const parsed = briefDraftSchema.safeParse(await kv.get(draftKey(id)));
      return parsed.success ? parsed.data : null;
    },
    async dropDraft(id) {
      await kv.delete(draftKey(id));
    },
    async markReturned(id) {
      await kv.set(returnedKey(id), true);
    },
    async isReturned(id) {
      return (await kv.get(returnedKey(id))) === true;
    },
    putThreadReturned: (threadId, briefId) => serialized(threadReturnedKey(threadId), () => kv.set(threadReturnedKey(threadId), briefId)),
    async getThreadReturned(threadId) {
      const briefId = await kv.get(threadReturnedKey(threadId));
      return typeof briefId === "string" ? briefId : null;
    },
    clearThreadReturned: (threadId, briefId) =>
      serialized(threadReturnedKey(threadId), async () => {
        if ((await kv.get(threadReturnedKey(threadId))) === briefId) await kv.delete(threadReturnedKey(threadId));
      }),
    async putThreadCarry(threadId, carried) {
      await kv.set(threadCarryKey(threadId), carried);
    },
    async getThreadCarry(threadId) {
      const parsed = carriedSchema.safeParse(await kv.get(threadCarryKey(threadId)));
      return parsed.success ? parsed.data : {};
    },
    async putThreadCriteria(threadId, items) {
      await (items.length === 0 ? kv.delete(threadCriteriaKey(threadId)) : kv.set(threadCriteriaKey(threadId), [...items]));
    },
    async getThreadCriteria(threadId) {
      const parsed = criteriaListSchema.safeParse(await kv.get(threadCriteriaKey(threadId)));
      return parsed.success ? parsed.data : [];
    },
    async putThreadScope(threadId, scope) {
      await kv.set(threadScopeKey(threadId), scope);
    },
    async getThreadScope(threadId) {
      const parsed = addSchema.safeParse(await kv.get(threadScopeKey(threadId)));
      return parsed.success ? parsed.data : null;
    },
    async isLaunched(threadId) {
      return (await kv.get(launchedKey(threadId))) === true;
    },
    async markLaunched(threadId) {
      await kv.set(launchedKey(threadId), true);
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
