import type { KvStore } from "./board-config.js";

/** Each board's manual order: task ids top to bottom (shared/manual-order.ts). */
export type TaskOrders = Readonly<Record<string, readonly string[]>>;

const ORDER_KEY = "taskOrder";

export async function loadTaskOrders(kv: KvStore): Promise<TaskOrders> {
  return (await kv.get<TaskOrders>(ORDER_KEY)) ?? {};
}

/**
 * The manual order of every board, in the plugin's KV rather than in the
 * task files — a drag must not turn into a git diff (see
 * docs/decisions/tasks-plus-manual-order-in-plugin-kv.md). Loaded once with
 * the store; reads answer from memory, and every change is written through
 * at once, a failed write going to `onError`.
 */
export function createOrderStore(kv: KvStore, initial: TaskOrders, onError: (error: unknown) => void) {
  let orders = initial;
  return {
    get(boardId: string): readonly string[] {
      return orders[boardId] ?? [];
    },
    set(boardId: string, ids: readonly string[]): Promise<void> {
      orders = { ...orders, [boardId]: [...ids] };
      return kv.set(ORDER_KEY, orders).catch(onError);
    },
  };
}

export type OrderStore = ReturnType<typeof createOrderStore>;
