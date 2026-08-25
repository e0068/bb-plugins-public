import type { FolderSyncStatusDto, FolderSyncSummary } from "./contract.js";

/**
 * Minimal kv shape this store needs, so the real bb.storage.kv and a test
 * fake share one contract (mirrors filesync/scan.ts's FileReader pattern).
 */
export interface FolderSyncKv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

const KEY_PREFIX = "folder-sync:";

function statusKey(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

const NOT_SYNCED: FolderSyncStatusDto = { kind: "not_synced" };

/**
 * Per-project file-sync status: cached in memory for synchronous reads, and
 * persisted to kv for "synced"/"error" outcomes so a plugin reload or server
 * restart remembers the last real result. "syncing" is deliberately never
 * persisted — it exists only in memory. A crash or reload mid-run must not
 * strand a folder showing "syncing" forever: the next read (or the next sync
 * attempt) is what resolves it, not a leftover disk row.
 */
export class FolderSyncStatusStore {
  private readonly cache = new Map<string, FolderSyncStatusDto>();

  constructor(private readonly kv: FolderSyncKv) {}

  /** Loads from kv on first access per project, then serves from cache. */
  async load(projectId: string): Promise<FolderSyncStatusDto> {
    const cached = this.cache.get(projectId);
    if (cached) return cached;
    const persisted = await this.kv.get<FolderSyncStatusDto>(
      statusKey(projectId),
    );
    const status = persisted ?? NOT_SYNCED;
    this.cache.set(projectId, status);
    return status;
  }

  /** Synchronous best-effort read for callers that cannot await (e.g. a list
   * built from already-loaded projects). Returns "not_synced" if unloaded. */
  peek(projectId: string): FolderSyncStatusDto {
    return this.cache.get(projectId) ?? NOT_SYNCED;
  }

  setSyncing(projectId: string): void {
    this.cache.set(projectId, { kind: "syncing" });
  }

  async setSynced(
    projectId: string,
    summary: FolderSyncSummary,
    invalidFiles: { path: string; reason: string }[],
    syncedAt: string,
  ): Promise<void> {
    const status: FolderSyncStatusDto = {
      kind: "synced",
      syncedAt,
      summary,
      invalidFiles,
    };
    this.cache.set(projectId, status);
    await this.kv.set(statusKey(projectId), status);
  }

  async setError(
    projectId: string,
    message: string,
    failedAt: string,
  ): Promise<void> {
    const status: FolderSyncStatusDto = { kind: "error", failedAt, message };
    this.cache.set(projectId, status);
    await this.kv.set(statusKey(projectId), status);
  }

  /** Drops both the cached and persisted status (folder disconnected). */
  async clear(projectId: string): Promise<void> {
    this.cache.delete(projectId);
    await this.kv.delete(statusKey(projectId));
  }
}
