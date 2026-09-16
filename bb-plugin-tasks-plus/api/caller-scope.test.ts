// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import plugin from "../server";
import type { Task } from "../shared/contract";
import { currentCallerEnvironment } from "../filesync/caller-scope.js";
import type { CallerEnvironment } from "../filesync/caller-root.js";
import { withCallerScope } from "./caller-scope.js";

const BB_PROJECT_ID = "proj_x";
const TASKS_FOLDER = "memory/tasks";

let mainCheckout: string;
let worktree: string;
let environmentGets: string[];

function environmentOf(environmentId: string) {
  return environmentId === "env_1"
    ? {
        id: "env_1",
        projectId: BB_PROJECT_ID,
        path: worktree,
        name: "agent-x",
        branchName: "bb/thr_worktree",
        isWorktree: true,
        hostId: "host_worktree",
      }
    : {
        id: "env_main",
        projectId: BB_PROJECT_ID,
        path: mainCheckout,
        name: null,
        branchName: "main",
        isWorktree: false,
        hostId: "host_main",
      };
}

function setup(options: { environmentFails?: boolean } = {}) {
  const source = {
    isDefault: true,
    path: mainCheckout,
    hostId: "host_1",
    type: "local_path",
  };
  const project = { id: BB_PROJECT_ID, name: "Repo", sources: [source] };
  const { bb, harness } = createFakePluginHost({
    pluginId: "tasks",
    sdk: {
      projects: { get: async () => project, list: async () => [project] },
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({
          id: threadId,
          environmentId: threadId === "thr_worktree" ? "env_1" : "env_main",
        }),
        list: async () => {
          throw new Error("обход живых деревьев запрещён — BBPL-293");
        },
      },
      environments: {
        get: async ({ environmentId }: { environmentId: string }) => {
          environmentGets.push(environmentId);
          if (options.environmentFails) throw new Error("окружение недоступно");
          return environmentOf(environmentId);
        },
      },
    },
  });
  return { bb, harness };
}

async function connect(harness: { callRpc: (m: string, i?: unknown) => unknown }) {
  const connected = (await harness.callRpc("addSyncedFolder", {
    bbProjectId: BB_PROJECT_ID,
    tasksFolder: TASKS_FOLDER,
  })) as { ok: true; folder: { projectId: string; projectPrefix: string } };
  expect(connected.ok).toBe(true);
  return connected.folder;
}

beforeEach(() => {
  mainCheckout = mkdtempSync(join(tmpdir(), "api-scope-main-"));
  worktree = mkdtempSync(join(tmpdir(), "api-scope-tree-"));
  environmentGets = [];
});
afterEach(() => {
  rmSync(mainCheckout, { recursive: true, force: true });
  rmSync(worktree, { recursive: true, force: true });
});

/**
 * Обёртка — единственное место, где интерфейс получает то же знание о дереве,
 * которым давно пользуется CLI: область вызова на время одного обработчика.
 */
describe("withCallerScope", () => {
  const environment: CallerEnvironment = {
    environmentId: "env_1",
    projectId: BB_PROJECT_ID,
    path: "/worktrees/env_1",
    name: "agent-x",
    branchName: "bb/thr_worktree",
    isWorktree: true,
    hostId: "host_worktree",
  };
  const cache = {
    calls: [] as string[],
    async get(threadId: string) {
      this.calls.push(threadId);
      return environment;
    },
  };

  beforeEach(() => {
    cache.calls = [];
  });

  it("выполняет задачный метод в области вызова треда", async () => {
    let seen: CallerEnvironment | null = null;
    const handlers = withCallerScope(cache, {
      listTasks: () => {
        seen = currentCallerEnvironment();
        return { tasks: [], nextCursor: null };
      },
    });

    await handlers.listTasks({ callerThreadId: "thr_worktree" } as never);

    expect(seen).toEqual(environment);
    expect(cache.calls).toEqual(["thr_worktree"]);
  });

  it("служебное поле до обработчика не доходит", async () => {
    let seen: unknown;
    const handlers = withCallerScope(cache, {
      listTasks: (input: unknown) => {
        seen = input;
        return { tasks: [], nextCursor: null };
      },
    });

    await handlers.listTasks({ callerThreadId: "thr_worktree", limit: 5 } as never);

    expect(seen).toEqual({ limit: 5 });
  });

  it("без поля треда обработчик работает вне области вызова", async () => {
    let seen: CallerEnvironment | null = { ...environment };
    const handlers = withCallerScope(cache, {
      listTasks: () => {
        seen = currentCallerEnvironment();
        return { tasks: [], nextCursor: null };
      },
    });

    await handlers.listTasks({ limit: 5 } as never);

    expect(seen).toBeNull();
    expect(cache.calls).toEqual([]);
  });

  it("метод вне списка окружение не резолвит", async () => {
    const handlers = withCallerScope(cache, {
      listFolders: () => ({ folders: [] }),
    });

    await handlers.listFolders(null as never);

    expect(cache.calls).toEqual([]);
  });
});

describe("запрос RPC из треда с рабочим деревом", () => {
  it("создаёт задачу в дереве треда, не трогая главный чекаут", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const folder = await connect(harness);

    const created = (await harness.callRpc("createTask", {
      projectId: folder.projectId,
      title: "Branch local",
      callerThreadId: "thr_worktree",
    })) as { task: Task };

    expect(created.task.source?.filePath).toBe(
      join(worktree, TASKS_FOLDER, "backlog", "branch-local.md"),
    );
    expect(existsSync(join(mainCheckout, TASKS_FOLDER, "backlog"))).toBe(false);
  });

  it("видит задачи своего дерева, а доска без треда — задачи main", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const folder = await connect(harness);

    await harness.callRpc("createTask", { projectId: folder.projectId, title: "On board" });
    await harness.callRpc("createTask", {
      projectId: folder.projectId,
      title: "In branch",
      callerThreadId: "thr_worktree",
    });

    const fromThread = (await harness.callRpc("listTasks", {
      projectId: folder.projectId,
      callerThreadId: "thr_worktree",
    })) as { tasks: Task[] };
    const fromBoard = (await harness.callRpc("listTasks", {
      projectId: folder.projectId,
    })) as { tasks: Task[] };

    expect(fromThread.tasks.map((task) => task.title)).toEqual(["In branch"]);
    expect(fromBoard.tasks.map((task) => task.title)).toEqual(["On board"]);
  });

  it("недоступное окружение не роняет вызов — ответ приходит из main", async () => {
    const { bb, harness } = setup({ environmentFails: true });
    await plugin(bb);
    const folder = await connect(harness);

    await harness.callRpc("createTask", { projectId: folder.projectId, title: "On board" });

    const page = (await harness.callRpc("listTasks", {
      projectId: folder.projectId,
      callerThreadId: "thr_worktree",
    })) as { tasks: Task[] };

    expect(page.tasks.map((task) => task.title)).toEqual(["On board"]);
  });

});

/**
 * Кнопка «Делегировать» и загрузка вложения стоят в той же панели треда, но
 * ходят мимо клиента RPC: первая — своим контрактом, вторая — своим
 * HTTP-роутом. Без треда в запросе задача ветки для них не существует, а
 * общая правится в главном чекауте — то самое, что задача обещала прекратить.
 */
describe("поверхности треда мимо клиента RPC", () => {
  async function taskInWorktree(harness: {
    callRpc: (m: string, i?: unknown) => unknown;
  }, projectId: string) {
    return (await harness.callRpc("createTask", {
      projectId,
      title: "Branch local",
      callerThreadId: "thr_worktree",
    })) as { task: Task };
  }

  it("делегирование из треда находит задачу его дерева", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const folder = await connect(harness);
    const created = await taskInWorktree(harness, folder.projectId);

    // Дальше делегирование упрётся в отсутствующий пресет — это и значит,
    // что задачу оно нашло.
    await expect(
      harness.callRpc("delegate", {
        taskId: created.task.id,
        presetId: "01HZZZZZZZZZZZZZZZZZZZZZE1",
        callerThreadId: "thr_worktree",
      }),
    ).rejects.toThrow(/Preset not found/);
  });

  it("делегирование без треда задачу ветки не видит", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const folder = await connect(harness);
    const created = await taskInWorktree(harness, folder.projectId);

    await expect(
      harness.callRpc("delegate", {
        taskId: created.task.id,
        presetId: "01HZZZZZZZZZZZZZZZZZZZZZE1",
      }),
    ).rejects.toThrow(/Task not found/);
  });

  it("вложение из треда ложится в файл задачи его дерева", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const folder = await connect(harness);
    const created = await taskInWorktree(harness, folder.projectId);

    const response = await harness.fetchHttp(
      "POST",
      `/attachments/upload?taskId=${created.task.id}&fileName=note.txt&mime=text/plain&callerThreadId=thr_worktree`,
      { body: new TextEncoder().encode("привет") },
    );

    expect(response.status).toBe(201);
    expect(
      readFileSync(join(worktree, TASKS_FOLDER, "backlog", "branch-local.md"), "utf8"),
    ).toContain("note.txt");
  });

  it("вложение без треда отвечает отказом, а не падением", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const folder = await connect(harness);
    const created = await taskInWorktree(harness, folder.projectId);

    const response = await harness.fetchHttp(
      "POST",
      `/attachments/upload?taskId=${created.task.id}&fileName=note.txt&mime=text/plain`,
      { body: new TextEncoder().encode("привет") },
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

