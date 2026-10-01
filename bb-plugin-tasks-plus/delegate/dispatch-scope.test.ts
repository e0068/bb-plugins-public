import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TasksApiStore } from "../api";
import type { Preset } from "../db/types.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { currentCallerEnvironment } from "../filesync/caller-scope.js";
import { createFileTasksStore } from "../filesync/store.js";
import { handlers } from "./index.js";

const PRESET_ID = "01M1S870BSWT7HM0XRQ3D9P4YJ";

let mainDir: string;
let worktreeDir: string;
let store: TasksApiStore;

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

const preset: Preset = {
  id: PRESET_ID,
  name: "Opus",
  providerId: "claude-code",
  modelId: "opus",
  reasoningLevel: "high",
  permissionMode: "auto",
  environmentKind: "project-default",
  baseBranch: null,
  machineId: null,
  instructions: "",
  builtin: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const board: BoardConfig = {
  id: "b1",
  name: "Board",
  prefix: "TSK",
  color: "blue",
  folderId: null,
  linkedBbProjectId: "proj_1",
  tasksFolder: "tasks",
  database: null, createdAt: "2026-01-01T00:00:00.000Z",
};

/** Ровно то, чего касается отправка: тред заводится, его окружение читается. */
function fakeBb(): BbPluginApi {
  return {
    sdk: {
      threads: {
        async spawn() {
          return { id: "thr_new" };
        },
        async get({ threadId }: { threadId: string }) {
          return {
            id: threadId,
            environmentId: "env_1",
            status: "working",
            archivedAt: null,
            deletedAt: null,
          };
        },
      },
      environments: {
        async get({ environmentId }: { environmentId: string }) {
          return {
            id: environmentId,
            projectId: "proj_1",
            path: worktreeDir,
            name: "tree",
            branchName: "feature",
            isWorktree: true,
            hostId: "host_1",
          };
        },
      },
    },
    log: { warn() {} },
    realtime: { publish() {} },
  } as unknown as BbPluginApi;
}

async function taskInMain() {
  const task = await store.tasks.createTask({ projectId: "b1", title: "Work" });
  return (await store.tasks.getTask(task.id))!;
}

/** Копия задачи в ветке — та, что приехала туда вместе с деревом. Статус
 *  копии свой: ветка и main расходятся папками, и это норма. */
function copyIntoWorktree(filePath: string, status: string): string {
  const target = join(worktreeDir, "tasks", status, basename(filePath));
  mkdirSync(join(worktreeDir, "tasks", status), { recursive: true });
  copyFileSync(filePath, target);
  return target;
}

function inWorktree(filePath: string, status: string): string {
  return join(worktreeDir, "tasks", status, basename(filePath));
}

function inMain(filePath: string, status: string): string {
  return join(mainDir, "tasks", status, basename(filePath));
}

/** Тред без своего дерева: писать в него нечего. */
function fakeBbWithoutWorktree(): BbPluginApi {
  const bb = fakeBb();
  return {
    ...bb,
    sdk: {
      ...bb.sdk,
      threads: {
        ...bb.sdk.threads,
        async get({ threadId }: { threadId: string }) {
          return { id: threadId, environmentId: null, status: "working", archivedAt: null, deletedAt: null };
        },
      },
    },
  } as unknown as BbPluginApi;
}

beforeEach(() => {
  mainDir = mkdtempSync(join(tmpdir(), "dispatch-main-"));
  worktreeDir = mkdtempSync(join(tmpdir(), "dispatch-tree-"));
  const tasks = createFileTasksStore(
    fakeKv(),
    [board],
    [],
    [preset],
    [],
    () => {},
    currentCallerEnvironment,
  );
  tasks.setBoardRoots("b1", [
    { absPath: join(mainDir, "tasks"), origin: { kind: "main" } },
  ]);
  store = {
    tasks,
    transaction: (fn: () => unknown) => Promise.resolve(fn()),
  } as unknown as TasksApiStore;
});

afterEach(() => {
  rmSync(mainDir, { recursive: true, force: true });
  rmSync(worktreeDir, { recursive: true, force: true });
});

describe("отправка треда с доски", () => {
  it("пишет привязку и статус в дерево заведённого треда, а главный чекаут не трогает", async () => {
    const task = await taskInMain();
    const mainPath = task.source!.filePath;
    copyIntoWorktree(mainPath, "backlog");
    const mainBefore = readFileSync(mainPath, "utf8");

    await handlers(fakeBb(), store).delegate({ taskId: task.id, presetId: PRESET_ID });

    const inWorktree = join(worktreeDir, "tasks", "in_progress", basename(mainPath));
    expect(readFileSync(inWorktree, "utf8")).toContain("Dispatched to Opus");
    expect(readFileSync(mainPath, "utf8")).toBe(mainBefore);
    expect(existsSync(join(mainDir, "tasks", "in_progress", basename(mainPath)))).toBe(false);
  });

  it("задачи в дереве треда нет — запись остаётся при файле, второй копии слага не заводится", async () => {
    const task = await taskInMain();
    const mainPath = task.source!.filePath;

    await handlers(fakeBb(), store).delegate({ taskId: task.id, presetId: PRESET_ID });

    const moved = join(mainDir, "tasks", "in_progress", basename(mainPath));
    expect(readFileSync(moved, "utf8")).toContain("Dispatched to Opus");
    expect(existsSync(join(worktreeDir, "tasks"))).toBe(false);
  });
});

describe("статус пишется по той копии, которую перепишут", () => {
  it("ветка уже в done — отправка не откатывает её назад в работу", async () => {
    const task = await taskInMain();
    const mainPath = task.source!.filePath;
    const branchPath = copyIntoWorktree(mainPath, "done");

    await handlers(fakeBb(), store).delegate({ taskId: task.id, presetId: PRESET_ID });

    expect(existsSync(branchPath)).toBe(true);
    expect(existsSync(inWorktree(mainPath, "in_progress"))).toBe(false);
    expect(readFileSync(branchPath, "utf8")).toContain("Dispatched to Opus");
  });

  it("main уже в работе, а ветка ещё нет — в работу переводится копия ветки", async () => {
    const created = await taskInMain();
    await store.tasks.updateTask(created.id, { status: "in_progress" });
    const mainPath = (await store.tasks.getTask(created.id))!.source!.filePath;
    copyIntoWorktree(mainPath, "backlog");

    await handlers(fakeBb(), store).delegate({ taskId: created.id, presetId: PRESET_ID });

    expect(existsSync(inWorktree(mainPath, "in_progress"))).toBe(true);
    expect(existsSync(inWorktree(mainPath, "backlog"))).toBe(false);
  });
});

describe("привязка существующего треда", () => {
  it("пишет перевод в работу в дерево привязанного треда", async () => {
    const task = await taskInMain();
    const mainPath = task.source!.filePath;
    copyIntoWorktree(mainPath, "backlog");
    const mainBefore = readFileSync(mainPath, "utf8");

    await handlers(fakeBb(), store).taskThreadsAttach({ taskId: task.id, threadId: "thr_old" });

    expect(readFileSync(inWorktree(mainPath, "in_progress"), "utf8")).toContain(
      "Status changed to In Progress · thread attached",
    );
    expect(readFileSync(mainPath, "utf8")).toBe(mainBefore);
  });

  it("дерево есть, а задачи в нём нет — запись остаётся при файле", async () => {
    const task = await taskInMain();
    const mainPath = task.source!.filePath;

    await handlers(fakeBb(), store).taskThreadsAttach({ taskId: task.id, threadId: "thr_old" });

    expect(readFileSync(inMain(mainPath, "in_progress"), "utf8")).toContain(
      "Status changed to In Progress · thread attached",
    );
    expect(existsSync(join(worktreeDir, "tasks"))).toBe(false);
  });

  it("у треда нет своего дерева вовсе — запись тоже остаётся при файле", async () => {
    const task = await taskInMain();
    const mainPath = task.source!.filePath;
    copyIntoWorktree(mainPath, "backlog");

    await handlers(fakeBbWithoutWorktree(), store).taskThreadsAttach({
      taskId: task.id,
      threadId: "thr_old",
    });

    expect(existsSync(inMain(mainPath, "in_progress"))).toBe(true);
    expect(existsSync(inWorktree(mainPath, "backlog"))).toBe(true);
    expect(existsSync(inWorktree(mainPath, "in_progress"))).toBe(false);
  });
});
