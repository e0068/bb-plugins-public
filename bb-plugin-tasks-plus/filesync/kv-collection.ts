import type { KvStore } from "./board-config.js";
import { applyPatch } from "./patch.js";
import { createOrValidateUlid } from "./validators.js";

/**
 * A synchronous CRUD collection backed by one kv key holding a JSON array —
 * the shared shape behind Folders, Presets and SavedViews (each was its own
 * SQLite table; each is now "a few records a human edits", so one key is
 * plenty). Loaded once into memory at store creation; every mutation updates
 * the in-memory array immediately (so reads are synchronous, like the rest
 * of TasksStore) and persists to kv best-effort in the background.
 */
export function createKvCollection<T extends { id: string }>(
  kv: KvStore,
  key: string,
  initial: readonly T[],
  onPersistError: (error: unknown) => void,
) {
  let items = [...initial];

  function persist(): void {
    kv.set(key, items).catch(onPersistError);
  }

  function list(): T[] {
    return [...items];
  }

  function get(id: string): T | undefined {
    return items.find((item) => item.id === id);
  }

  function insert(withoutId: Omit<T, "id"> & { id?: string }): T {
    const id = createOrValidateUlid(withoutId.id);
    const item = { ...withoutId, id } as T;
    items = [...items, item];
    persist();
    return item;
  }

  function update(id: string, patch: Partial<Omit<T, "id">>): T {
    const current = get(id);
    if (!current) throw new Error(`Not found: ${id}`);
    // `Omit<T, "id">` is not provably a subtype of `T` for a generic T; the
    // widening is safe because the patch cannot carry an id by construction.
    const updated = applyPatch(current, patch as Partial<T>);
    items = items.map((item) => (item.id === id ? updated : item));
    persist();
    return updated;
  }

  function remove(id: string): boolean {
    const before = items.length;
    items = items.filter((item) => item.id !== id);
    if (items.length !== before) persist();
    return items.length !== before;
  }

  return { list, get, insert, update, remove };
}

export async function loadKvCollection<T>(
  kv: KvStore,
  key: string,
): Promise<T[]> {
  return (await kv.get<T[]>(key)) ?? [];
}
