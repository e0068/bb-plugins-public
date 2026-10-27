// Дочерние треды с открытой работой не уходят в архив вместе с родителем. bb архивирует тред вместе с детьми и
// способа «без детей» не даёт, поэтому шаг Archive сперва поднимает таких детей на уровень родителя в сайдбаре:
// оттуда архив родителя их уже не задевает.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { Steps } from "@bb-plugins/automation-steps/index";

type Threads = Pick<BbPluginApi["sdk"]["threads"], "list" | "get" | "update">;

export type SpareDeps = {
  sdk: { threads: Threads };
  /** Прогон треда начат и не закончен — по его этапам, как их ведёт Flow. */
  runOpen: (threadId: string) => Promise<boolean>;
};

/**
 * Потомки треда с открытой работой — прогон начат и не закончен, или агент сейчас в ходе — переезжают к родителю
 * треда (у корневого — в корень). Закрытого потомка обходят глубже: открытый внук под законченным ребёнком
 * тоже уходил бы в архив каскадом. Открытый потомок едет со всем своим поддеревом. Возвращает id поднятых;
 * сбой подъёма пробрасывается: лучше не архивировать, чем унести работу.
 */
export const spareOpenChildren = async (deps: SpareDeps, threadId: string): Promise<string[]> => {
  const open: string[] = [];
  let level = [threadId];
  while (level.length > 0) {
    const children = (await Promise.all(level.map((id) => deps.sdk.threads.list({ parentThreadId: id, includeHidden: true })))).flat();
    const marked = await Promise.all(children.map(async (child) => ((child.status === "active" || (await deps.runOpen(child.id))) ? child.id : null)));
    open.push(...marked.filter((id): id is string => id !== null));
    level = children.filter((_, index) => marked[index] === null).map((child) => child.id);
  }
  if (open.length === 0) return [];
  const { parentThreadId } = await deps.sdk.threads.get({ threadId });
  for (const id of open) await deps.sdk.threads.update({ threadId: id, parentThreadId });
  return open;
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Шаг Archive с подъёмом открытых детей перед архивацией; остальные шаги — как были. */
export const withSparedChildren = (steps: Steps, spare: (threadId: string) => Promise<string[]>): Steps => ({
  ...steps,
  "bb.archive": async (threadId) => {
    const spared = await spare(threadId).then(
      (ids) => ({ ok: true as const, ids }),
      (error: unknown) => ({ ok: false as const, error: messageOf(error) }),
    );
    if (!spared.ok) return { ok: false, error: `Open child threads could not be moved out of the archive: ${spared.error}` };
    const result = await steps["bb.archive"](threadId);
    return result.ok && spared.ids.length > 0
      ? { ...result, detail: `${spared.ids.length} child thread(s) with unfinished work moved up and kept out of the archive: ${spared.ids.join(", ")}` }
      : result;
  },
});
