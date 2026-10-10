// Новая сессия после выбора flow. Тред с «Автоматически» узнаёт flow посреди первого хода, когда Claude Code уже
// собрал список навыков, — а посреди сессии этот список не обновляется, и переключатель навыков первый ход не держит.
// Поэтому Flow помнит первое сообщение такого треда до конца первого хода, а когда агент в этом ходе выбрал flow и
// включён тумблер очистки в настройках Flow — или сессия стартовала урезанной до выбора, — на конце хода очищает контекст
// треда и отправляет сообщение заново, видимым только агенту: следующий ход начинается новой сессией, и та собирает список уже по настройкам
// дерева (./skill-scope.ts). Очистка, а не перезапуск: продолжение сессии потянуло бы старый список из истории. Сбой глотается: тред не должен встать из-за перезапуска.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";

const keyOf = (threadId: string): string => `fresh-session:${threadId}`;

const AGENT_ONLY = "agent-only";

/** Блоки первого сообщения как их отдаёт хук отправки и принимает отправка — Flow их не разбирает. */
const blocksSchema = z.array(z.record(z.string(), z.unknown()));
const stateSchema = z.object({ blocks: blocksSchema, pending: z.boolean() });
export type MessageBlocks = z.output<typeof blocksSchema>;

export type FreshSessionDeps = {
  kv: PluginKvStorage;
  /** Тред выбирает flow сам — «Автоматически» или унаследованный отказ агента: только его первое сообщение стоит помнить. */
  agentChooses: (threadId: string) => boolean;
  /** Нужна ли треду новая сессия: по тумблеру очистки или урезанной первой сессии, тред идёт в Claude Code и в своём дереве. */
  needed: (threadId: string) => Promise<boolean>;
  /** Сверка настроек дерева — до очистки, чтобы новая сессия их уже застала. */
  sync: (threadId: string) => Promise<void>;
  clear: (threadId: string) => Promise<unknown>;
  /** Отправка от имени Flow: ход владельца по ней выбор flow не применяет. */
  send: (threadId: string, blocks: MessageBlocks) => Promise<void>;
  /** Пометка агенту перед повторённым сообщением — видна только ему. */
  note: (threadId: string) => string;
  warn: (message: string) => void;
};

export const createFreshSession = (deps: FreshSessionDeps) => {
  const read = async (threadId: string) => {
    const parsed = stateSchema.safeParse(await deps.kv.get(keyOf(threadId)));
    return parsed.success ? parsed.data : null;
  };
  const forget = (threadId: string) => deps.kv.delete(keyOf(threadId));

  return {
    /** Первое сообщение нового треда: помнится, только пока тред выбирает flow сам. */
    remember: async (threadId: string, blocks: readonly unknown[]): Promise<void> => {
      const parsed = blocksSchema.safeParse(blocks);
      if (deps.agentChooses(threadId) && parsed.success) await deps.kv.set(keyOf(threadId), { blocks: parsed.data, pending: false });
    },
    /** Агент выбрал flow: `true` — Flow начнёт новую сессию на конце хода, и агенту пора закончить ход. */
    request: async (threadId: string): Promise<boolean> => {
      const state = await read(threadId);
      if (state === null) return false;
      if (!(await deps.needed(threadId).catch(() => false))) {
        await forget(threadId);
        return false;
      }
      await deps.kv.set(keyOf(threadId), { ...state, pending: true });
      return true;
    },
    /**
     * Конец хода: ждущий тред получает сверку настроек, чистый контекст и своё первое сообщение заново. Первый ход
     * прошёл без выбора flow — сообщение забывается: поздний выбор не должен повторить давнюю задачу.
     */
    idle: async (threadId: string): Promise<void> => {
      const state = await read(threadId);
      if (state === null) return;
      await forget(threadId);
      if (!state.pending) return;
      try {
        await deps.sync(threadId);
        await deps.clear(threadId);
      } catch (error) {
        deps.warn(`fresh session: thread ${threadId} not cleared (${error instanceof Error ? error.message : String(error)})`);
      }
      // Очистка не вышла — сообщение всё равно уходит: тред продолжает работу в прежней сессии, а не стоит.
      // Повтор — для новой сессии агента: у владельца сообщение уже стоит в ленте, второй его пузырь ему не нужен.
      const note = { type: "text", text: deps.note(threadId), mentions: [], visibility: AGENT_ONLY };
      await deps.send(threadId, [note, ...state.blocks.map((block) => ({ ...block, visibility: AGENT_ONLY }))]).catch((error: unknown) =>
        deps.warn(`fresh session: thread ${threadId} not resumed (${error instanceof Error ? error.message : String(error)})`),
      );
    },
    forget,
  };
};

export type FreshSession = ReturnType<typeof createFreshSession>;
