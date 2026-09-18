// Какой flow у треда и какой выбран в композере проекта. Инструкции агенту
// собираются синхронно, поэтому привязки живут в памяти и дописываются в kv
// следом. Новый тред берёт flow родителя, а без родителя — выбор своего проекта.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";

const THREAD_PREFIX = "thread-flow:";
const PROJECT_PREFIX = "project-flow:";

export type ThreadFlows = {
  flowOf(threadId: string): string | undefined;
  choiceOf(projectId: string): string | undefined;
  choose(projectId: string, flowId: string): Promise<void>;
  onThreadCreated(payload: { thread: { id: string; projectId: string; parentThreadId: string | null } }): void;
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
  let writes: Promise<unknown> = Promise.resolve();
  return {
    flowOf: (threadId) => threads.get(threadId),
    choiceOf: (projectId) => projects.get(projectId),
    async choose(projectId, flowId) {
      projects.set(projectId, flowId);
      await kv.set(`${PROJECT_PREFIX}${projectId}`, flowId);
    },
    onThreadCreated({ thread }) {
      const flowId = thread.parentThreadId === null ? projects.get(thread.projectId) : threads.get(thread.parentThreadId);
      if (flowId === undefined) return;
      // Память — сразу: сборка инструкций первого хода может прийти раньше записи в kv.
      threads.set(thread.id, flowId);
      writes = writes.then(() => kv.set(`${THREAD_PREFIX}${thread.id}`, flowId));
    },
    onThreadDeleted({ thread }) {
      if (!threads.delete(thread.id)) return;
      writes = writes.then(() => kv.delete(`${THREAD_PREFIX}${thread.id}`));
    },
    settled: async () => {
      await writes;
    },
  };
};
