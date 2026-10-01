import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { CallerEnvironment } from "./caller-root.js";
import { resolveCallerEnvironment } from "./resolve-roots.js";

/** Годится ли окружение под запись задачи: своё дерево уже лежит на диске. */
function worktreeReady(
  environment: CallerEnvironment | null,
): environment is CallerEnvironment {
  return environment !== null && environment.isWorktree && environment.path !== null;
}

export interface WorktreeWait {
  /** Сколько раз спросить, включая первый. */
  attempts: number;
  delayMs: number;
  sleep: (ms: number) => Promise<void>;
}

/**
 * Дерево треда, которое только что завели: тред отвечает раньше, чем хост
 * успевает создать ему worktree, поэтому вопрос повторяется — но конечное
 * число раз. Ни одна попытка не застала дерева — null, и запись остаётся
 * там, где была; ждать дольше значит держать отправку с доски открытой.
 */
export async function awaitThreadWorktree(
  resolve: () => Promise<CallerEnvironment | null>,
  { attempts, delayMs, sleep }: WorktreeWait,
): Promise<CallerEnvironment | null> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const environment = await resolve();
    if (worktreeReady(environment)) return environment;
    if (attempt < attempts) await sleep(delayMs);
  }
  return null;
}

/** Окружение треда по его id. Не бросает: недоступный тред — «дерева нет». */
export async function threadEnvironment(
  bb: BbPluginApi,
  threadId: string,
): Promise<CallerEnvironment | null> {
  try {
    const thread = await bb.sdk.threads.get({ threadId });
    return await resolveCallerEnvironment(bb, thread.environmentId ?? null);
  } catch (error) {
    // Вслух: немой откат в main и был тем, из-за чего дефект BBPL-293 прожил
    // незамеченным, а цена отката здесь — правка в главном чекауте.
    bb.log.warn(
      `tasks-plus: не удалось разрешить дерево треда ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
