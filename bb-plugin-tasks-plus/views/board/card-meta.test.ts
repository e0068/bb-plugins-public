import { describe, expect, it } from "vitest";
import type { Task, TaskThread } from "../../shared/contract.js";
import { boardCardMeta } from "./card-meta.js";

// BBPL-334: the board draws its columns from listTasks alone; the chips on
// each card are folded in from taskCardMeta once it lands.

const task = (id: string, extra: Partial<Task> = {}): Task =>
  ({ id, parentTaskId: null, status: "todo", ...extra }) as Task;

const thread = (liveStatus: TaskThread["liveStatus"]): TaskThread => ({
  id: "01M0T4QGCQ3BYK15NH50AD38RV",
  taskId: "b:t",
  threadId: `thr_${liveStatus}`,
  presetName: liveStatus,
  title: liveStatus,
  liveStatus,
  archivedAt: null,
  attachedAt: "2026-01-01T00:00:00.000Z",
});

describe("boardCardMeta", () => {
  const tasks = [
    task("b:a"),
    task("b:b"),
    task("b:a1", { parentTaskId: "b:a", status: "done" }),
    task("b:a2", { parentTaskId: "b:a", status: "todo" }),
  ];

  it("gives every task, child or not, its progress over all tasks under it, without any card data", () => {
    const meta = boardCardMeta([...tasks, task("b:a11", { parentTaskId: "b:a1", status: "done" })], undefined);
    expect([...meta.keys()]).toEqual(["b:a", "b:b", "b:a1", "b:a2", "b:a11"]);
    expect(meta.get("b:a")?.progress).toMatchObject({ done: 2, total: 3 });
    expect(meta.get("b:a1")?.progress).toMatchObject({ done: 1, total: 1 });
    expect(meta.get("b:b")).toMatchObject({ workingThreads: [], attachmentCount: 0, progress: { done: 0, total: 0 } });
  });

  it("takes attachments and only starting or working threads from card data", () => {
    const meta = boardCardMeta(tasks, [
      { taskId: "b:a", attachmentCount: 3, taskThreads: [thread("working"), thread("idle"), thread("starting"), thread("completed")] },
    ]);
    expect(meta.get("b:a")?.attachmentCount).toBe(3);
    expect(meta.get("b:a")?.workingThreads.map((t) => t.liveStatus)).toEqual(["working", "starting"]);
    expect(meta.get("b:b")).toMatchObject({ attachmentCount: 0, workingThreads: [] });
  });
});
