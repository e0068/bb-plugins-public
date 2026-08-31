// Слой 2 — источник вкладки: из PluginFileOpenerSource получить хост и корень
// для чтения/записи. Единственная bb-I/O здесь идёт через переданный `bb`
// (модуль его не импортирует на верхнем уровне — только type-only), поэтому
// слой тестируется мок-объектом без живого SDK.
//
// Что задаёт `source.kind` (см. memory/wiki/bb-plugin-file-opener-slot.md):
//   workspace     — путь относителен воркдереву окружения; корень = env.path;
//   thread-storage — путь относителен корню стораджа треда;
//   host          — путь абсолютный, корня-фенса НЕТ (файл может жить на другой
//                   машине — memory/decisions/opener-host-path-no-home-fence.md).
//
// Хост нужен ВСЕМ файловым вызовам: пропуск на удалённой машине убивает фичу
// целиком, а не «слегка ухудшает».
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export interface OpenerSource {
  kind: "host" | "thread-storage" | "workspace";
  threadId: string | null;
  environmentId: string | null;
  projectId: string | null;
}

export interface ResolvedSource {
  /** Хост файлов (undefined — локальный хост сервера bb). */
  hostId: string | undefined;
  /**
   * Абсолютный корень, ниже которого confine'ится чтение/запись (rootPath,
   * symlink-safe). undefined для kind:"host" — там границы нет намеренно.
   */
  root: string | undefined;
}

/**
 * Резолвит source в { hostId, root }. Возвращает null, когда источник не даёт
 * нужного (нет environmentId у workspace, нет threadId у thread-storage, у
 * окружения ещё нет пути) — вызывающий превращает это в понятную ошибку, а не в
 * чтение мимо корня.
 */
export async function resolveSource(
  bb: BbPluginApi,
  source: OpenerSource,
): Promise<ResolvedSource | null> {
  if (source.kind === "workspace") {
    if (!source.environmentId) return null;
    const env = await bb.sdk.environments.get({
      environmentId: source.environmentId,
    });
    if (!env.path) return null;
    return { hostId: env.hostId, root: env.path };
  }

  // Хост для thread-storage/host берём из окружения (там и живёт hostId файлов
  // треда). Нет окружения — локальный хост.
  const hostId = source.environmentId
    ? (await bb.sdk.environments.get({ environmentId: source.environmentId }))
        .hostId
    : undefined;

  if (source.kind === "thread-storage") {
    if (!source.threadId) return null;
    const storage = await bb.sdk.threads.storageFiles({
      threadId: source.threadId,
    });
    return { hostId, root: storage.storageRootPath };
  }

  // host — путь абсолютный, фенса нет.
  return { hostId, root: undefined };
}
