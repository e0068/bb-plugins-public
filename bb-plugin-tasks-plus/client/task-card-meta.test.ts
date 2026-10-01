// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listTaskCardMeta, type TasksRpc } from "./data.js";
import { TASK_CARD_META_MAX_IDS } from "../shared/pagination.js";

// BBPL-334: the list may hold more tasks than one taskCardMeta call accepts;
// the client asks in chunks and hands back the cards in the order asked.
describe("listTaskCardMeta", () => {
  it("splits ids into contract-sized calls and keeps their order", async () => {
    const asked: string[][] = [];
    const rpc = {
      call: async (_method: string, input: { taskIds: string[] }) => {
        asked.push(input.taskIds);
        return {
          cards: input.taskIds.map((taskId) => ({ taskId, attachmentCount: 0, taskThreads: [] })),
        };
      },
    } as unknown as TasksRpc;
    const ids = Array.from({ length: TASK_CARD_META_MAX_IDS * 2 + 3 }, (_, i) => `b:t${i}`);

    const cards = await listTaskCardMeta(rpc, ids);

    expect(asked.map((chunk) => chunk.length)).toEqual([TASK_CARD_META_MAX_IDS, TASK_CARD_META_MAX_IDS, 3]);
    expect(cards.map((card) => card.taskId)).toEqual(ids);
  });

  it("no ids — no call", async () => {
    let calls = 0;
    const rpc = { call: async () => { calls += 1; return { cards: [] }; } } as unknown as TasksRpc;
    expect(await listTaskCardMeta(rpc, [])).toEqual([]);
    expect(calls).toBe(0);
  });
});
