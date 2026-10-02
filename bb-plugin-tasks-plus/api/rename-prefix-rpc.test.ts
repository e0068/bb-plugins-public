// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTransitionLog } from "../db/transition-log.js";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerTasksApi, type TasksApiStore } from "./index.js";

const board = (id: string, prefix: string): BoardConfig => ({
  id,
  name: prefix,
  prefix,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: "tasks",
  database: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const SHADER = board("01M0T4QGCQ3BYK15NH50AD38RV", "SHA");
const OTHER = board("01M0T4QGCQ3BYK15NH50AD38RW", "OTH");

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return { get: async (key) => map.get(key) as never, set: async (key, value) => void map.set(key, structuredClone(value)) };
}

let root: string;
let otherRoot: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rename-prefix-"));
  otherRoot = mkdtempSync(join(tmpdir(), "rename-prefix-other-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(otherRoot, { recursive: true, force: true });
});

function host() {
  const tasks = createFileTasksStore(fakeKv(), [SHADER, OTHER], [], [], [], () => {});
  tasks.setBoardRoots(SHADER.id, [{ absPath: root, origin: { kind: "main" } }]);
  tasks.setBoardRoots(OTHER.id, [{ absPath: otherRoot, origin: { kind: "main" } }]);
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const store: TasksApiStore = {
    tasks,
    transitions: createTransitionLog(bb.storage.database()),
    transaction: (operation) => tasks.transaction(operation),
    projectTaskCount: async (projectId) => (await tasks.listTasks({ projectId })).length,
    projectPrefixExists: (prefix, excluding) => tasks.listProjects().some((entry) => entry.id !== excluding && entry.prefix.toLowerCase() === prefix.toLowerCase()),
    openTaskCount: async () => (await tasks.listTasks({})).length,
    sidebarSummary: async () => [],
  };
  registerTasksApi(bb, store, { get: async () => null });
  const rename = (projectId: string, prefix: string) => harness.callRpc("renameProjectPrefix", { projectId, prefix }) as Promise<{ ok: boolean; project?: { prefix: string }; error?: { code: string } }>;
  return { tasks, rename };
}

/** A task file written by hand, the way an older board left it. */
function handWritten(slug: string, key: string, body = "") {
  mkdirSync(join(root, "todo"), { recursive: true });
  writeFileSync(join(root, "todo", `${slug}.md`), `---\ntitle: ${slug}\nslug: ${slug}\nkey: ${key}\n---\n\n${body}\n\n## Comments\n`);
}

describe("renameProjectPrefix renames the keys of every task of the board", () => {
  it("gives each task the new prefix with its own number, and the board answers to the new keys only", async () => {
    const { tasks, rename } = host();
    const first = await tasks.createTask({ projectId: SHADER.id, title: "First" });
    const second = await tasks.createTask({ projectId: SHADER.id, title: "Second" });

    const result = await rename(SHADER.id, "SL");

    expect(result.ok).toBe(true);
    expect(result.project?.prefix).toBe("SL");
    expect((await tasks.getTaskByKey("SL-1"))?.id).toBe(first.id);
    expect((await tasks.getTaskByKey("SL-2"))?.id).toBe(second.id);
    expect(await tasks.getTaskByKey("SHA-2")).toBeUndefined();
    expect(readFileSync((await tasks.getTask(second.id))!.source!.filePath, "utf8")).toContain("key: SL-2");
  });

  it("keeps a subtask under its parent", async () => {
    const { tasks, rename } = host();
    const parent = await tasks.createTask({ projectId: SHADER.id, title: "Parent" });
    const child = await tasks.createTask({ projectId: SHADER.id, title: "Child", parentTaskId: parent.id });

    await rename(SHADER.id, "SL");

    expect((await tasks.getTask(child.id))?.parentTaskId).toBe(parent.id);
    expect(readFileSync((await tasks.getTask(child.id))!.source!.filePath, "utf8")).toContain("parent: SL-1");
  });

  it("numbers the next new task after the highest renamed one", async () => {
    const { tasks, rename } = host();
    handWritten("seven", "SHA-7");

    await rename(SHADER.id, "SL");

    expect((await tasks.createTask({ projectId: SHADER.id, title: "Next" })).key).toBe("SL-8");
  });

  it("renames keys left under an older prefix too, the second of two equal numbers taking a free one", async () => {
    const { tasks, rename } = host();
    handWritten("current", "SHA-5");
    handWritten("older", "BP-5");
    handWritten("oldest", "BP-9");

    await rename(SHADER.id, "SL");

    const keys = (await tasks.listTasks({ projectId: SHADER.id })).map((task) => task.key).sort();
    expect(keys).toEqual(["SL-10", "SL-5", "SL-9"]);
    expect((await tasks.getTaskByKey("SL-10"))?.title).toBe("older");
  });

  it("rewrites mentions of the board's old keys in descriptions and comments, and leaves other keys", async () => {
    const { tasks, rename } = host();
    const first = await tasks.createTask({ projectId: SHADER.id, title: "First" });
    const second = await tasks.createTask({ projectId: SHADER.id, title: "Second", description: "Follows SHA-1, unlike OTH-1." });
    await tasks.createComment({ taskId: first.id, kind: "agent", authorName: "Agent", body: 'Blocked by ::task{key="SHA-2"}' });

    await rename(SHADER.id, "SL");

    expect((await tasks.getTask(second.id))?.description).toBe("Follows SL-1, unlike OTH-1.");
    expect((await tasks.listComments(first.id)).map((comment) => comment.body)).toEqual(['Blocked by ::task{key="SL-2"}']);
  });

  it("leaves a task with no key unnamed by its slug, even a slug that reads like a key", async () => {
    const { tasks, rename } = host();
    await tasks.createTask({ projectId: SHADER.id, title: "First" });
    mkdirSync(join(root, "todo"), { recursive: true });
    writeFileSync(join(root, "todo", "release-2.md"), "---\ntitle: Release\nslug: release-2\n---\n\nAfter SHA-1.\n\n## Comments\n");

    await rename(SHADER.id, "SL");

    const keys = (await tasks.listTasks({ projectId: SHADER.id })).map((task) => task.key).sort();
    expect(keys).toEqual(["SL-1", "SL-2"]);
    expect(readFileSync(join(root, "todo", "release-2.md"), "utf8")).toContain("After SL-1.");
  });

  it("gives a task created while the rename runs the new prefix and a number of its own", async () => {
    const { tasks, rename } = host();
    for (const title of ["One", "Two", "Three"]) await tasks.createTask({ projectId: SHADER.id, title });

    await Promise.all([rename(SHADER.id, "SL"), tasks.createTask({ projectId: SHADER.id, title: "Late" })]);

    const keys = (await tasks.listTasks({ projectId: SHADER.id })).map((task) => task.key).sort();
    expect(keys).toEqual(["SL-1", "SL-2", "SL-3", "SL-4"]);
  });

  it("makes a task created after the rename started wait for it and take the new prefix", async () => {
    const { tasks } = host();
    for (const title of ["One", "Two", "Three"]) await tasks.createTask({ projectId: SHADER.id, title });

    const renaming = tasks.renameBoardPrefix(SHADER.id, "SL");
    const late = tasks.createTask({ projectId: SHADER.id, title: "Late" });
    await Promise.all([renaming, late]);

    expect((await late).key).toBe("SL-4");
  });

  it("refuses a prefix another board has, and leaves every key as it was", async () => {
    const { tasks, rename } = host();
    await tasks.createTask({ projectId: SHADER.id, title: "First" });

    const result = await rename(SHADER.id, "OTH");

    expect(result).toMatchObject({ ok: false, error: { code: "project_prefix_conflict" } });
    expect((await tasks.getTaskByKey("SHA-1"))?.title).toBe("First");
    expect(tasks.getProject(SHADER.id)?.prefix).toBe("SHA");
  });
});
