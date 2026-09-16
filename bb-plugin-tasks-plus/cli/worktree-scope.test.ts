import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import plugin from "../server";
import type { Task } from "../shared/contract";

// Сквозной сценарий дефекта BBPL-293: команда приходит из треда, который
// работает в worktree, и файл задачи обязан лечь в это дерево, а не в
// главный чекаут — иначе слияние ветки конфликтует само с собой.
const BB_PROJECT_ID = "proj_x";
const TASKS_FOLDER = "memory/tasks";

let mainCheckout: string;
let worktree: string;
let environmentGets: string[];
let fileReads: Array<{ hostId?: string; path: string }>;

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

function setup() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "tasks",
    sdk: {
      projects: {
        get: async () => ({
          id: BB_PROJECT_ID,
          name: "Repo",
          sources: [
            { isDefault: true, path: mainCheckout, hostId: "host_1", type: "local_path" },
          ],
        }),
        list: async () => [
          {
            id: BB_PROJECT_ID,
            name: "Repo",
            sources: [
              { isDefault: true, path: mainCheckout, hostId: "host_1", type: "local_path" },
            ],
          },
        ],
      },
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({
          id: threadId,
          environmentId: threadId === "thr_worktree" ? "env_1" : "env_main",
        }),
        list: async () => {
          throw new Error("обход живых деревьев запрещён — BBPL-293");
        },
      },
      files: {
        read: async ({ hostId, path }: { hostId?: string; path: string }) => {
          fileReads.push({ hostId, path });
          return { content: "вложение", contentEncoding: "utf8" };
        },
      },
      environments: {
        get: async ({ environmentId }: { environmentId: string }) => {
          environmentGets.push(environmentId);
          return environmentOf(environmentId);
        },
      },
    },
  });
  return { bb, harness };
}

function ok(result: { exitCode: number; stdout: string; stderr: string }): string {
  expect(result, result.stderr).toMatchObject({ exitCode: 0, stderr: "" });
  return result.stdout;
}

beforeEach(() => {
  mainCheckout = mkdtempSync(join(tmpdir(), "wt-scope-main-"));
  worktree = mkdtempSync(join(tmpdir(), "wt-scope-tree-"));
  environmentGets = [];
  fileReads = [];
});
afterEach(() => {
  rmSync(mainCheckout, { recursive: true, force: true });
  rmSync(worktree, { recursive: true, force: true });
});

describe("bb tasks из треда в worktree", () => {
  it("создаёт, читает и переводит задачу в дереве своего треда, не трогая main", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const connected = (await harness.callRpc("addSyncedFolder", {
      bbProjectId: BB_PROJECT_ID,
      tasksFolder: TASKS_FOLDER,
    })) as { ok: true; folder: { projectPrefix: string } };
    expect(connected.ok).toBe(true);
    const prefix = connected.folder.projectPrefix;
    const fromWorktree = { threadId: "thr_worktree", projectId: BB_PROJECT_ID };

    const created = JSON.parse(
      ok(
        await harness.runCli(
          ["create", "--project", prefix, "--title", "Branch local", "--json"],
          fromWorktree,
        ),
      ),
    ).task as Task;

    expect(created.source?.filePath).toBe(
      join(worktree, TASKS_FOLDER, "backlog", "branch-local.md"),
    );
    expect(created.source?.origin).toMatchObject({
      kind: "worktree",
      environmentId: "env_1",
      branchName: "bb/thr_worktree",
    });
    // Ключ выдаёт доска, а доска увидит задачу после слияния: пока она живёт
    // в ветке, адрес у неё — слаг файла (BBPL-294).
    expect(created.number).toBeNull();
    expect(created.key).toBe("branch-local");
    expect(existsSync(join(mainCheckout, TASKS_FOLDER, "backlog"))).toBe(false);

    // Свою задачу тред видит; интерфейс доски (без дерева) и тред главного
    // чекаута — нет: она появится у них после слияния ветки.
    expect(
      JSON.parse(
        ok(await harness.runCli(["list", "--project", prefix, "--json"], fromWorktree)),
      ).tasks.map((task: Task) => task.title),
    ).toEqual(["Branch local"]);
    expect(
      JSON.parse(ok(await harness.runCli(["list", "--project", prefix, "--json"]))).tasks,
    ).toEqual([]);
    expect(
      JSON.parse(
        ok(
          await harness.runCli(["list", "--project", prefix, "--json"], {
            threadId: "thr_main",
            projectId: BB_PROJECT_ID,
          }),
        ),
      ).tasks,
    ).toEqual([]);
    expect(
      ok(await harness.runCli(["show", created.key, "--json"], fromWorktree)),
    ).toContain("Branch local");

    const updated = JSON.parse(
      ok(
        await harness.runCli(
          ["update", created.key, "--status", "in_progress", "--json"],
          fromWorktree,
        ),
      ),
    ).task as Task;
    expect(updated.source?.filePath).toBe(
      join(worktree, TASKS_FOLDER, "in_progress", "branch-local.md"),
    );
    expect(existsSync(join(worktree, TASKS_FOLDER, "backlog", "branch-local.md"))).toBe(false);
    expect(existsSync(join(mainCheckout, TASKS_FOLDER))).toBe(false);

    await harness.dispose();
  });

  it("из треда главного чекаута кладёт задачу в main", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const connected = (await harness.callRpc("addSyncedFolder", {
      bbProjectId: BB_PROJECT_ID,
      tasksFolder: TASKS_FOLDER,
    })) as { ok: true; folder: { projectPrefix: string } };
    const prefix = connected.folder.projectPrefix;

    const created = JSON.parse(
      ok(
        await harness.runCli(
          ["create", "--project", prefix, "--title", "Main task", "--json"],
          { threadId: "thr_main", projectId: BB_PROJECT_ID },
        ),
      ),
    ).task as Task;

    expect(created.source?.filePath).toBe(
      join(mainCheckout, TASKS_FOLDER, "backlog", "main-task.md"),
    );
    expect(created.source?.origin).toEqual({ kind: "main" });
    expect(existsSync(join(worktree, TASKS_FOLDER))).toBe(false);

    await harness.dispose();
  });

  // Файлы вложения лежат на машине вызывающего, а не на сервере плагина.
  // Машину знает то же окружение, что и дерево, — второй раз хост не
  // спрашивается.
  it("вложение читается на машине вызывающего треда, окружение резолвится один раз", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const connected = (await harness.callRpc("addSyncedFolder", {
      bbProjectId: BB_PROJECT_ID,
      tasksFolder: TASKS_FOLDER,
    })) as { ok: true; folder: { projectPrefix: string } };
    const prefix = connected.folder.projectPrefix;

    ok(
      await harness.runCli(
        [
          "create",
          "--project",
          prefix,
          "--title",
          "With attachment",
          "--attach",
          "/на/машине/треда/note.md",
          "--json",
        ],
        { threadId: "thr_worktree", projectId: BB_PROJECT_ID },
      ),
    );

    expect(fileReads).toEqual([
      { hostId: "host_worktree", path: "/на/машине/треда/note.md" },
    ]);
    expect(environmentGets).toEqual(["env_1"]);

    await harness.dispose();
  });
});
