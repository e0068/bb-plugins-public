// @vitest-environment node
// Системный комментарий, пришедший после смены статуса, ложится в журнал того
// же файла в новой папке и не воскрешает копию в старой. 2026-09-06 такая
// копия появилась у BBPL-281 (коммит 2c26875) — её оставил автопубликатор
// Tasks+, убранный в тот же день; тест держит обещание на будущее.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { createFileTasksStore } from "../filesync/store.js";
import { createSystemComment } from "./index.js";

let root: string;
let store: ReturnType<typeof createFileTasksStore>;

const kv: KvStore = { get: async () => undefined as never, set: async () => {} };
const board: BoardConfig = { id: "b1", name: "Board", prefix: "TSK", color: "blue", folderId: null, linkedBbProjectId: null, tasksFolder: "tasks", database: null, createdAt: "2026-01-01T00:00:00.000Z" };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "status-comment-"));
  store = createFileTasksStore(kv, [board], [], [], [], () => {});
  store.setBoardRoots("b1", [{ absPath: root, origin: { kind: "main" } }]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Папки статуса, в которых лежит файл задачи. */
const foldersHolding = (file: string) => readdirSync(root).filter((folder) => readdirSync(join(root, folder)).includes(file));

const completed = (taskId: string) =>
  createSystemComment(store, { taskId, presetName: "Attached", threadId: "thr_abc", body: "Thread completed — final message posted" });

describe("системный комментарий после смены статуса", () => {
  it("файл один, в новой папке, комментарий в его журнале", async () => {
    const task = await store.createTask({ projectId: "b1", title: "Moved", status: "in_progress" });
    await store.updateTask(task.id, { status: "in_review" });
    await completed(task.id);

    expect(foldersHolding("moved.md")).toEqual(["in_review"]);
    expect(readFileSync(join(root, "in_review", "moved.md"), "utf8")).toContain("Thread completed — final message posted");
  });

  it("задача, прочитанная до смены статуса, комментарием не возвращается в старую папку", async () => {
    const task = await store.createTask({ projectId: "b1", title: "Moved", status: "in_progress" });
    const before = (await store.getTask(task.id))!;
    await store.updateTask(task.id, { status: "in_review" });
    await completed(before.id);

    expect(foldersHolding("moved.md")).toEqual(["in_review"]);
    expect((await store.getTask(task.id))?.status).toBe("in_review");
  });
});
