import { describe, expect, it } from "vitest";
import { tasksRpcContract } from "./contract";

const thread = (id: string) => ({
  id,
  taskId: "01M1PAAE346PVZ70F1JQRPKF7B:context-meter",
  threadId: "thr_v45q86h42b",
  presetName: "Attached",
  title: "Context Meter",
  liveStatus: "idle" as const,
  archivedAt: null,
  attachedAt: "2026-09-12T18:10:00.000Z",
});

const cards = (id: string) =>
  tasksRpcContract.taskCardMeta.output.safeParse({
    cards: [{ taskId: "01M1PAAE346PVZ70F1JQRPKF7B:context-meter", attachmentCount: 0, taskThreads: [thread(id)] }],
  });

// A task file's `threads:` block is written by hand too, and one record with
// a made-up id must not fail the card chips of the whole board.
describe("a thread record's id", () => {
  it("passes when written by hand, not as a ULID", () => {
    expect(cards("01M2AS5V0000000000000003").success).toBe(true);
  });

  it("passes as a ULID", () => {
    expect(cards("01M39NRPSHKNH5FP9MPKFDVPFX").success).toBe(true);
  });

  it("is rejected when blank", () => {
    expect(cards("").success).toBe(false);
  });
});
