import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { CallerEnvironment } from "./caller-root.js";
import { resolveCallerEnvironment } from "./resolve-roots.js";

/** Память о том, в каком дереве работает тред. */
export interface CallerEnvironmentCache {
  get(threadId: string): Promise<CallerEnvironment | null>;
}

export interface CallerEnvironmentCacheOptions {
  /** Сколько помнится разрешённое окружение. Тред меняет дерево редко. */
  ttlMs?: number;
  /** Сколько помнится отказ хоста — меньше, чтобы починка хоста была видна. */
  failureTtlMs?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_FAILURE_TTL_MS = 5_000;

/** Ответ резолва вместе с тем, был ли это отказ: «у треда нет своего дерева»
 *  и «хост не ответил» дают одинаковый null, но помнить их надо по-разному. */
interface Resolution {
  environment: CallerEnvironment | null;
  failed: boolean;
}

interface Entry {
  expiresAt: number;
  resolution: Promise<Resolution>;
}

/**
 * Резолвит окружение вызывающего треда и помнит ответ. Панель треда делает
 * десятки вызовов RPC подряд, и без памяти каждый из них шёл бы к хосту за
 * одним и тем же ответом — нагрузка, ради снятия которой и запрещён обход
 * живых деревьев (decisions/tasks-plus-board-roots-blocks-rpc.md). Хранится
 * не значение, а обещание: параллельные вызовы одного треда склеиваются в
 * одно обращение, а не в три одинаковых.
 *
 * Никогда не бросает: недоступный тред или окружение означают «своего дерева
 * нет», и запрос работает с main.
 */
export function createCallerEnvironmentCache(
  bb: BbPluginApi,
  options: CallerEnvironmentCacheOptions = {},
): CallerEnvironmentCache {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const failureTtlMs = options.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  async function resolve(threadId: string): Promise<Resolution> {
    let environmentId: string | null;
    try {
      environmentId = (await bb.sdk.threads.get({ threadId })).environmentId ?? null;
    } catch (error) {
      bb.log.warn(
        `tasks-plus: не удалось прочитать тред ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { environment: null, failed: true };
    }
    if (environmentId === null) return { environment: null, failed: false };
    const environment = await resolveCallerEnvironment(bb, environmentId);
    return { environment, failed: environment === null };
  }

  return {
    async get(threadId: string): Promise<CallerEnvironment | null> {
      const hit = entries.get(threadId);
      if (hit && hit.expiresAt > now()) return (await hit.resolution).environment;

      const resolution = resolve(threadId);
      // Срок ставится до ответа — иначе параллельные вызовы не увидели бы
      // запись и пошли бы к хосту каждый сам. После ответа он уточняется.
      entries.set(threadId, { expiresAt: now() + ttlMs, resolution });
      const settled = await resolution;
      entries.set(threadId, {
        expiresAt: now() + (settled.failed ? failureTtlMs : ttlMs),
        resolution,
      });
      return settled.environment;
    },
  };
}
