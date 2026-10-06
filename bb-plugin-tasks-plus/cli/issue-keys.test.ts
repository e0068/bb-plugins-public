import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import plugin from "../server";
import type { Task } from "../shared/contract";

// Задача, рождённая в ветке, живёт без ключа (BBPL-294), а правки из треда
// идут в его дерево, где ключ не выдаётся. Поэтому ключ выдаёт отдельная
// команда, которую шаг Flow зовёт из дерева треда сразу после того, как
// ветка догнала main: номера идут после наибольшего в только что
// подтянутом main.
const BB_PROJECT_ID = "proj_x";
const TASKS_FOLDER = "docs/tasks";

let mainCheckout: string;
let worktree: string;

function setup() {
  const environment = (environmentId: string) =>
    environmentId === "env_1"
      ? { id: "env_1", projectId: BB_PROJECT_ID, path: worktree, name: "agent-x", branchName: "bb/thr_worktree", isWorktree: true, hostId: "host_1" }
      : { id: "env_main", projectId: BB_PROJECT_ID, path: mainCheckout, name: null, branchName: "main", isWorktree: false, hostId: "host_1" };
  const project = { id: BB_PROJECT_ID, name: "Repo", sources: [{ isDefault: true, path: mainCheckout, hostId: "host_1", type: "local_path" }] };
  return createFakePluginHost({
    pluginId: "tasks",
    sdk: {
      projects: { get: async () => project, list: async () => [project] },
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, environmentId: threadId === "thr_worktree" ? "env_1" : "env_main" }),
      },
      environments: { get: async ({ environmentId }: { environmentId: string }) => environment(environmentId) },
    },
  });
}

function ok(result: { exitCode: number; stdout: string; stderr: string }): string {
  expect(result, result.stderr).toMatchObject({ exitCode: 0 });
  return result.stdout;
}

const fileOf = (root: string, slug: string): string => readFileSync(join(root, TASKS_FOLDER, "backlog", `${slug}.md`), "utf8");

beforeEach(() => {
  mainCheckout = mkdtempSync(join(tmpdir(), "issue-keys-main-"));
  worktree = mkdtempSync(join(tmpdir(), "issue-keys-tree-"));
});
afterEach(() => {
  rmSync(mainCheckout, { recursive: true, force: true });
  rmSync(worktree, { recursive: true, force: true });
});

describe("bb tasks keys issue из дерева треда", () => {
  it("выдаёт бесключевым задачам ветки номера после наибольшего в main, родителю раньше ребёнка, и не трогает main", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const connected = (await harness.callRpc("addSyncedFolder", { bbProjectId: BB_PROJECT_ID, tasksFolder: TASKS_FOLDER })) as {
      ok: true;
      folder: { projectPrefix: string };
    };
    const prefix = connected.folder.projectPrefix;
    const fromMain = { threadId: "thr_main", projectId: BB_PROJECT_ID };
    const fromWorktree = { threadId: "thr_worktree", projectId: BB_PROJECT_ID };

    for (const title of ["First", "Second"]) ok(await harness.runCli(["create", "--project", prefix, "--title", title, "--json"], fromMain));
    // Ветка догнала main: его задачи лежат и в дереве треда.
    cpSync(join(mainCheckout, "docs"), join(worktree, "docs"), { recursive: true });
    const epic = JSON.parse(ok(await harness.runCli(["create", "--project", prefix, "--title", "Branch epic", "--type", "epic", "--json"], fromWorktree))).task as Task;
    ok(await harness.runCli(["create", "--project", prefix, "--title", "Branch child", "--parent", epic.key, "--json"], fromWorktree));
    // Обычная правка из дерева ключа не выдаёт — его выдаёт только команда.
    expect(JSON.parse(ok(await harness.runCli(["update", "branch-epic", "--priority", "high", "--json"], fromWorktree))).task.number).toBeNull();

    const issued = JSON.parse(ok(await harness.runCli(["keys", "issue", "--json"], fromWorktree))).issued;

    expect(issued).toEqual([
      { slug: "branch-epic", key: `${prefix}-3` },
      { slug: "branch-child", key: `${prefix}-4` },
    ]);
    expect(fileOf(worktree, "branch-epic")).toContain(`key: ${prefix}-3`);
    expect(fileOf(worktree, "branch-child")).toContain(`key: ${prefix}-4`);
    expect(fileOf(worktree, "branch-child")).toContain(`parent: ${prefix}-3`);
    expect(readdirSync(join(mainCheckout, TASKS_FOLDER, "backlog")).sort()).toEqual(["first.md", "second.md"]);
    expect(existsSync(join(mainCheckout, TASKS_FOLDER, "backlog", "branch-epic.md"))).toBe(false);

    // Второй прогон ничего не меняет: выданный ключ не перевыдаётся.
    expect(JSON.parse(ok(await harness.runCli(["keys", "issue", "--json"], fromWorktree))).issued).toEqual([]);

    await harness.dispose();
  });

  it("задача ветки, уже слитая в main и правленная только из дерева, получает ключ в дереве, а main не меняется", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const connected = (await harness.callRpc("addSyncedFolder", { bbProjectId: BB_PROJECT_ID, tasksFolder: TASKS_FOLDER })) as {
      ok: true;
      folder: { projectPrefix: string };
    };
    const prefix = connected.folder.projectPrefix;
    const fromWorktree = { threadId: "thr_worktree", projectId: BB_PROJECT_ID };
    ok(await harness.runCli(["create", "--project", prefix, "--title", "Merged task", "--json"], fromWorktree));
    // Ветку слили: тот же файл лежит и в главном чекауте.
    cpSync(join(worktree, "docs"), join(mainCheckout, "docs"), { recursive: true });
    ok(await harness.runCli(["comment", "merged-task", "--body", "из дерева", "--json"], fromWorktree));
    const mainBefore = fileOf(mainCheckout, "merged-task");

    expect(JSON.parse(ok(await harness.runCli(["keys", "issue", "--json"], fromWorktree))).issued).toEqual([{ slug: "merged-task", key: `${prefix}-1` }]);
    expect(fileOf(worktree, "merged-task")).toContain(`key: ${prefix}-1`);
    expect(fileOf(mainCheckout, "merged-task")).toBe(mainBefore);

    await harness.dispose();
  });

  it("обходит номера, занятые в главном чекауте задачами, созданными с доски и ещё не закоммиченными", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const connected = (await harness.callRpc("addSyncedFolder", { bbProjectId: BB_PROJECT_ID, tasksFolder: TASKS_FOLDER })) as {
      ok: true;
      folder: { projectPrefix: string };
    };
    const prefix = connected.folder.projectPrefix;
    const fromWorktree = { threadId: "thr_worktree", projectId: BB_PROJECT_ID };
    ok(await harness.runCli(["create", "--project", prefix, "--title", "Branch task", "--json"], fromWorktree));
    // Задача с доски: ключ выдан, файл лежит в главном чекауте, в ветку не попал.
    ok(await harness.runCli(["create", "--project", prefix, "--title", "Made on the board", "--json"], { threadId: "thr_main", projectId: BB_PROJECT_ID }));

    expect(JSON.parse(ok(await harness.runCli(["keys", "issue", "--json"], fromWorktree))).issued).toEqual([{ slug: "branch-task", key: `${prefix}-2` }]);

    await harness.dispose();
  });

  it("у проекта без доски выдавать нечего — команда отвечает пустым списком", async () => {
    const { bb, harness } = setup();
    await plugin(bb);

    expect(JSON.parse(ok(await harness.runCli(["keys", "issue", "--json"], { threadId: "thr_worktree", projectId: BB_PROJECT_ID }))).issued).toEqual([]);

    await harness.dispose();
  });
});
