import { describe, expect, it } from "vitest";
import type { KvStore } from "./board-config.js";
import { createOrderStore, loadTaskOrders } from "./order-store.js";

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    async get(key) {
      return map.get(key) as never;
    },
    async set(key, value) {
      map.set(key, structuredClone(value));
    },
  };
}

describe("order store", () => {
  it("has no order for a board nobody reordered", () => {
    expect(createOrderStore(fakeKv(), {}, () => {}).get("b1")).toEqual([]);
  });

  it("keeps a saved order across a restart", async () => {
    const kv = fakeKv();
    await createOrderStore(kv, {}, () => {}).set("b1", ["b1:c", "b1:a"]);

    const reloaded = createOrderStore(kv, await loadTaskOrders(kv), () => {});

    expect(reloaded.get("b1")).toEqual(["b1:c", "b1:a"]);
  });

  it("keeps each board's order apart", async () => {
    const kv = fakeKv();
    const orders = createOrderStore(kv, {}, () => {});
    await orders.set("b1", ["b1:a"]);
    await orders.set("b2", ["b2:x", "b2:y"]);

    const reloaded = createOrderStore(kv, await loadTaskOrders(kv), () => {});

    expect(reloaded.get("b1")).toEqual(["b1:a"]);
    expect(reloaded.get("b2")).toEqual(["b2:x", "b2:y"]);
  });

  it("hands a failed write to onError and still answers from memory", async () => {
    const errors: unknown[] = [];
    const broken: KvStore = { get: async () => undefined, set: async () => Promise.reject(new Error("disk full")) };
    const orders = createOrderStore(broken, {}, (error) => errors.push(error));

    await orders.set("b1", ["b1:a"]);

    expect(orders.get("b1")).toEqual(["b1:a"]);
    expect(errors).toHaveLength(1);
  });
});
