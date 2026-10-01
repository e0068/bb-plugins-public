import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerTasksApi, type TasksApiStore } from ".";

// BBPL-334: the taskCardMeta RPC hands the store's bulk card data to the board
// and the list in one call.

const BOARD: BoardConfig = {
  id: "01M0T4QGCQ3BYK15NH50AD38RV",
  name: "Board",
  prefix: "TSK",
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: "tasks",
  database: null, createdAt: "2026-01-01T00:00:00.000Z",
};

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

let root: string;
let tasks: ReturnType<typeof createFileTasksStore>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "card-meta-rpc-"));
  tasks = createFileTasksStore(fakeKv(), [BOARD], [], [], [], () => {});
  tasks.setBoardRoots(BOARD.id, [{ absPath: root, origin: { kind: "main" } }]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function apiStore(): TasksApiStore {
  return {
    tasks,
    transitions: { record() {}, range: () => [], firstAtMs: () => null },
    transaction: (operation) => tasks.transaction(operation),
    projectTaskCount: async () => 0,
    projectPrefixExists: () => false,
    openTaskCount: async () => 0,
    sidebarSummary: async () => [],
  };
}

describe("taskCardMeta RPC", () => {
  it("returns attachment counts and threads for the asked tasks", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    registerTasksApi(bb, apiStore());
    const task = await tasks.createTask({ projectId: BOARD.id, title: "Card" });
    await tasks.createAttachment({ taskId: task.id, fileName: "a.png", mime: "image/png", sizeBytes: 1, blobPath: "blobs/a.png", isImage: true });
    await tasks.upsertTaskThread({ taskId: task.id, threadId: "thr_x", presetName: "Opus", title: "Work" });

    const result = (await harness.behavior.callRpc("taskCardMeta", { taskIds: [task.id] })) as {
      cards: { taskId: string; attachmentCount: number; taskThreads: { threadId: string }[] }[];
    };

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ taskId: task.id, attachmentCount: 1 });
    expect(result.cards[0]!.taskThreads.map((thread) => thread.threadId)).toEqual(["thr_x"]);
  });
});
