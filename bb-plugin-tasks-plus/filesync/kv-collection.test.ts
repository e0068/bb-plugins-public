import { describe, it, expect, vi } from "vitest";
import { createKvCollection } from "./kv-collection.js";
import type { KvStore } from "./board-config.js";

function fakeKv(): KvStore {
  const store = new Map<string, unknown>();
  return {
    async get(key) {
      return store.get(key) as never;
    },
    async set(key, value) {
      store.set(key, value);
    },
  };
}

interface Item {
  id: string;
  name: string;
}

describe("createKvCollection", () => {
  it("создаёт запись с новым id и находит её", () => {
    const col = createKvCollection<Item>(fakeKv(), "items", [], () => {});
    const created = col.insert({ name: "First" });
    expect(col.get(created.id)?.name).toBe("First");
    expect(col.list()).toHaveLength(1);
  });

  it("обновляет запись частично", () => {
    const col = createKvCollection<Item>(fakeKv(), "items", [], () => {});
    const created = col.insert({ name: "Old" });
    const updated = col.update(created.id, { name: "New" });
    expect(updated.name).toBe("New");
    expect(col.get(created.id)?.name).toBe("New");
  });

  it("undefined в патче не затирает поле (так шлёт CLI folder update --move)", () => {
    const col = createKvCollection<Item>(fakeKv(), "items", [], () => {});
    const created = col.insert({ name: "Keep" });
    expect(col.update(created.id, { name: undefined }).name).toBe("Keep");
    expect(col.get(created.id)?.name).toBe("Keep");
  });

  it("падает при обновлении несуществующей записи", () => {
    const col = createKvCollection<Item>(fakeKv(), "items", [], () => {});
    expect(() => col.update("missing", { name: "x" })).toThrow();
  });

  it("удаляет запись, возвращая true только когда что-то удалено", () => {
    const col = createKvCollection<Item>(fakeKv(), "items", [], () => {});
    const created = col.insert({ name: "X" });
    expect(col.remove(created.id)).toBe(true);
    expect(col.remove(created.id)).toBe(false);
  });

  it("сообщает об ошибке персиста, не роняя мутацию", async () => {
    const kv: KvStore = {
      async get() {
        return undefined;
      },
      async set() {
        throw new Error("kv unavailable");
      },
    };
    const onError = vi.fn();
    const col = createKvCollection<Item>(kv, "items", [], onError);
    col.insert({ name: "X" });
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalled();
  });
});
