import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTasksStore } from "./store.js";
import type { BoardConfig, KvStore } from "./board-config.js";

// BBPL-334: a board card's chips (attachments, working agents) for many tasks
// at once. The per-task listAttachmentsForTask / listTaskThreads each re-read
// the whole board, so asking for every card that way costs boards × cards.

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    async get(key) {
      return map.get(key) as never;
    },
    async set(key, value) {
      map.set(key, value);
    },
  };
}

function boardConfig(id: string, prefix: string): BoardConfig {
  return { id, name: id, prefix, color: "blue", folderId: null, linkedBbProjectId: null, tasksFolder: "tasks", database: null, createdAt: "2026-01-01T00:00:00.000Z" };
}

let roots: string[];
let store: ReturnType<typeof createFileTasksStore>;

beforeEach(() => {
  roots = [mkdtempSync(join(tmpdir(), "card-meta-")), mkdtempSync(join(tmpdir(), "card-meta-"))];
  store = createFileTasksStore(fakeKv(), [boardConfig("b1", "ONE"), boardConfig("b2", "TWO")], [], [], [], () => {});
  store.setBoardRoots("b1", [{ absPath: roots[0]!, origin: { kind: "main" } }]);
  store.setBoardRoots("b2", [{ absPath: roots[1]!, origin: { kind: "main" } }]);
});
afterEach(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("taskCardMeta", () => {
  it("answers what listAttachmentsForTask and listTaskThreads answer, per task, across boards", async () => {
    const plain = await store.createTask({ projectId: "b1", title: "Plain" });
    const busy = await store.createTask({ projectId: "b1", title: "Busy" });
    const other = await store.createTask({ projectId: "b2", title: "Other board" });
    await store.createAttachment({ taskId: busy.id, fileName: "a.png", mime: "image/png", sizeBytes: 1, blobPath: "blobs/a.png", isImage: true });
    await store.createAttachment({ taskId: busy.id, fileName: "b.png", mime: "image/png", sizeBytes: 1, blobPath: "blobs/b.png", isImage: true });
    await store.upsertTaskThread({ taskId: busy.id, threadId: "thr_w", presetName: "Opus", title: "Work" });
    await store.upsertTaskThread({ taskId: other.id, threadId: "thr_o", presetName: "Sonnet", title: "Other" });
    store.setThreadLiveState("thr_w", { liveStatus: "working", archivedAt: null });

    const cards = await store.taskCardMeta([plain.id, busy.id, other.id]);

    const expected = await Promise.all(
      [plain, busy, other].map(async (task) => ({
        taskId: task.id,
        attachmentCount: (await store.listAttachmentsForTask(task.id)).length,
        taskThreads: await store.listTaskThreads(task.id),
      })),
    );
    expect(cards).toEqual(expected);
    expect(cards[1]).toMatchObject({ attachmentCount: 2 });
    expect(cards[1]!.taskThreads.map((thread) => thread.liveStatus)).toEqual(["working"]);
  });

  it("leaves out ids no board knows", async () => {
    const task = await store.createTask({ projectId: "b1", title: "Known" });
    const cards = await store.taskCardMeta(["b1:missing", "nope:x", task.id]);
    expect(cards.map((card) => card.taskId)).toEqual([task.id]);
  });

  it("no ids — no cards", async () => {
    expect(await store.taskCardMeta([])).toEqual([]);
  });
});
