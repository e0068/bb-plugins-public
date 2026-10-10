// Какой flow у треда, какой выбран над его композером до отправки и какой —
// в композере проекта. Инструкции агенту собираются синхронно, поэтому привязки
// живут в памяти и дописываются в kv следом. Новый тред берёт flow родителя,
// а без родителя — выбор своего проекта; тред Side chat — «без flow».
import type { PluginKvStorage } from "@get-bb/plugin-sdk";

import { AGENT_NO_FLOW, NO_FLOW } from "../core/flows";
import { isSideChat } from "../core/side-chat";

const THREAD_PREFIX = "thread-flow:";
const PROJECT_PREFIX = "project-flow:";
const PICK_PREFIX = "thread-flow-pick:";

/** Новый тред глазами привязки: проект, родитель и плагин, который его создал. */
export type NewThread = { id: string; projectId: string; parentThreadId: string | null; originPluginId?: string | null };

export type ThreadFlows = {
  flowOf(threadId: string): string | undefined;
  /** Треды под Flow: назначенный flow и «Автоматически», пока агент не выбрал; отказ от flow не в счёт. */
  withFlow(): string[];
  /** Ставит треду flow: следующий прогон в нём пойдёт по нему, а не по выбору проекта. */
  assign(threadId: string, flowId: string): Promise<void>;
  /** Flow, выбранный над композером треда и ждущий сообщения владельца; не выбран — `undefined`. */
  pickedOf(threadId: string): string | undefined;
  /** Запоминает выбор до отправки; `null` снимает запомненный. Flow треду не назначает. */
  pick(threadId: string, flowId: string | null): Promise<void>;
  /** Отдаёт выбор и снимает его: применяет его сообщение, которым владелец начал ход. */
  takePicked(threadId: string): Promise<string | undefined>;
  choiceOf(projectId: string): string | undefined;
  choose(projectId: string, flowId: string): Promise<void>;
  /** Привязывает новый тред к flow родителя, а без родителя — к выбору проекта, тред Side chat — к «без flow»; уже привязанный не трогает. Зовут и событие создания, и первое сообщение: bb не обещает их порядка. */
  bind(thread: NewThread): void;
  onThreadCreated(payload: { thread: NewThread }): void;
  onThreadDeleted(payload: { thread: { id: string } }): void;
  /** Ждёт записи в kv, начатые привязками новых тредов. */
  settled(): Promise<void>;
};

const readAll = async (kv: PluginKvStorage, prefix: string): Promise<Map<string, string>> => {
  const keys = await kv.list(prefix);
  const entries = await Promise.all(keys.map(async (key) => [key.slice(prefix.length), await kv.get<unknown>(key)] as const));
  return new Map(entries.filter((entry): entry is readonly [string, string] => typeof entry[1] === "string"));
};

export const createThreadFlows = async (kv: PluginKvStorage): Promise<ThreadFlows> => {
  const threads = await readAll(kv, THREAD_PREFIX);
  const projects = await readAll(kv, PROJECT_PREFIX);
  const picks = await readAll(kv, PICK_PREFIX);
  let writes: Promise<unknown> = Promise.resolve();
  const unpick = async (threadId: string) => {
    if (picks.delete(threadId)) await kv.delete(`${PICK_PREFIX}${threadId}`);
  };
  const bind: ThreadFlows["bind"] = (thread) => {
    // Уже привязанный тред — привязан первым сообщением раньше события создания, например flow исходного треда передачи.
    if (threads.has(thread.id)) return;
    const flowId = isSideChat(thread) ? NO_FLOW : thread.parentThreadId === null ? projects.get(thread.projectId) : threads.get(thread.parentThreadId);
    if (flowId === undefined) return;
    // Память — сразу: сборка инструкций первого хода может прийти раньше записи в kv.
    threads.set(thread.id, flowId);
    writes = writes.then(() => kv.set(`${THREAD_PREFIX}${thread.id}`, flowId));
  };
  return {
    flowOf: (threadId) => threads.get(threadId),
    withFlow: () => [...threads].flatMap(([threadId, flowId]) => (flowId === NO_FLOW || flowId === AGENT_NO_FLOW ? [] : [threadId])),
    async assign(threadId, flowId) {
      threads.set(threadId, flowId);
      await kv.set(`${THREAD_PREFIX}${threadId}`, flowId);
    },
    pickedOf: (threadId) => picks.get(threadId),
    async pick(threadId, flowId) {
      if (flowId === null) return unpick(threadId);
      picks.set(threadId, flowId);
      await kv.set(`${PICK_PREFIX}${threadId}`, flowId);
    },
    async takePicked(threadId) {
      const picked = picks.get(threadId);
      await unpick(threadId);
      return picked;
    },
    choiceOf: (projectId) => projects.get(projectId),
    async choose(projectId, flowId) {
      projects.set(projectId, flowId);
      await kv.set(`${PROJECT_PREFIX}${projectId}`, flowId);
    },
    bind,
    onThreadCreated: ({ thread }) => bind(thread),
    onThreadDeleted({ thread }) {
      if (threads.delete(thread.id)) writes = writes.then(() => kv.delete(`${THREAD_PREFIX}${thread.id}`));
      if (picks.delete(thread.id)) writes = writes.then(() => kv.delete(`${PICK_PREFIX}${thread.id}`));
    },
    settled: async () => {
      await writes;
    },
  };
};
