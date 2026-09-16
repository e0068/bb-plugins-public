import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin from "../server";

function stdout(result: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): string {
  expect(result, result.stderr).toMatchObject({ exitCode: 0, stderr: "" });
  return result.stdout;
}

describe("bb tasks CLI", () => {
  it("lists seed-demo in help while retaining the explicit confirmation guard", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);

    expect(stdout(await harness.runCli(["--help"]))).toContain(
      "seed-demo                      Create sample data (requires --yes)",
    );
    await expect(harness.runCli(["seed-demo"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "seed-demo creates sample data; re-run with --yes",
    });

    await harness.dispose();
  });

  it("validates combined project and folder updates before mutating", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);
    stdout(
      await harness.runCli([
        "project",
        "create",
        "--name",
        "Atomic project",
        "--prefix",
        "ATOM",
      ]),
    );
    stdout(
      await harness.runCli(["folder", "create", "--name", "Original folder"]),
    );

    const invalidProjectUpdate = await harness.runCli([
      "project",
      "update",
      "ATOM",
      "--rename-prefix",
      "NEXT",
      "--link-bb-project",
      "not-a-project-id",
    ]);
    expect(invalidProjectUpdate).toMatchObject({ exitCode: 1, stdout: "" });
    expect(
      JSON.parse(
        stdout(await harness.runCli(["project", "show", "ATOM", "--json"])),
      ).project,
    ).toMatchObject({ prefix: "ATOM", linkedBbProjectId: null });

    await expect(
      harness.runCli([
        "folder",
        "update",
        "Original folder",
        "--name",
        "Partially renamed",
        "--parent",
        "Missing parent",
      ]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "folder not found: Missing parent",
    });
    const folders = JSON.parse(
      stdout(await harness.runCli(["folder", "list", "--json"])),
    ).folders;
    expect(folders).toEqual([
      expect.objectContaining({
        name: "Original folder",
        parentFolderId: null,
      }),
    ]);

    await harness.dispose();
  });

  it("reports friendly preset target validation errors", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    await plugin(bb);
    const required = [
      "preset",
      "create",
      "--name",
      "Invalid target",
      "--provider",
      "codex",
      "--model",
      "gpt-5.6-sol",
      "--reasoning",
      "high",
      "--permission",
      "full",
    ];

    await expect(
      harness.runCli([...required, "--environment", "branch"]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr:
        "invalid --environment branch; expected project-default or worktree",
    });
    await expect(
      harness.runCli([...required, "--base-branch", "main"]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--base-branch requires --environment worktree",
    });
    await expect(
      harness.runCli([...required, "--machine", "missing"]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--machine requires --environment worktree",
    });

    await harness.dispose();
  });
});

// ---------------------------------------------------------------------------
// Addressing and file-level edits through the CLI, on a real board folder.
// The three tests above never create a task: a board needs a resolved
// checkout path, which the plugin gets from bb.sdk. Here the file store is
// wired by hand, as api/list-filters.test.ts does for the RPC seam.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { registerTasksCli } from "./index.js";
import type { TasksApiStore } from "../api/index.js";

const BOARD: BoardConfig = {
  id: "01M0T4QGCQ3BYK15NH50AD38RV",
  name: "Board",
  prefix: "TSK",
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: "tasks",
  createdAt: "2026-01-01T00:00:00.000Z",
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
  root = mkdtempSync(join(tmpdir(), "cli-files-"));
  tasks = createFileTasksStore(fakeKv(), [BOARD], [], [], [], () => {});
  tasks.setBoardRoots(BOARD.id, [{ absPath: root, origin: { kind: "main" } }]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fileHost() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const store: TasksApiStore = {
    tasks,
    // The CLI never touches the transition log; a no-op double keeps this store
    // total without a database (real behaviour is covered in db/transition-log.test.ts).
    transitions: { record() {}, range: () => [] },
    transaction: (operation) => tasks.transaction(operation),
    projectTaskCount: async (projectId) => (await tasks.listTasks({ projectId })).length,
    projectPrefixExists: () => false,
    openTaskCount: async () => (await tasks.listTasks({})).length,
    sidebarSummary: async () => [],
  };
  registerTasksCli(bb, store, { name: "Tasks+", version: "test" });
  return harness;
}

function writeKeylessFile(status: string, slug: string, title: string): string {
  mkdirSync(join(root, status), { recursive: true });
  const filePath = join(root, status, `${slug}.md`);
  writeFileSync(filePath, `---\ntitle: ${title}\n---\n\nBody.\n`);
  return filePath;
}

describe("bb tasks CLI on a board folder", () => {
  it("show открывает задачу по ключу, по слагу и по файловому id", async () => {
    const harness = fileHost();
    const created = await tasks.createTask({ projectId: BOARD.id, title: "Find Me" });

    for (const address of ["TSK-1", "tsk-1", "find-me", created.id]) {
      const shown = JSON.parse(stdout(await harness.runCli(["show", address, "--json"])));
      expect(shown.task.id, address).toBe(created.id);
    }
    await harness.dispose();
  });

  it("show открывает бесключевой файл по слагу", async () => {
    const harness = fileHost();
    writeKeylessFile("backlog", "hand-written", "Hand written");

    const shown = JSON.parse(stdout(await harness.runCli(["show", "hand-written", "--json"])));
    expect(shown.task).toMatchObject({ key: "hand-written", title: "Hand written", number: null });
    await harness.dispose();
  });

  it("show неизвестного адреса отвечает task not found", async () => {
    const harness = fileHost();
    await expect(harness.runCli(["show", "nothing-here"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "task not found: nothing-here",
    });
    await harness.dispose();
  });

  it("update --slug переносит файл под новое имя", async () => {
    const harness = fileHost();
    await tasks.createTask({ projectId: BOARD.id, title: "Old Name" });

    stdout(await harness.runCli(["update", "TSK-1", "--slug", "new-name"]));

    expect(existsSync(join(root, "backlog", "old-name.md"))).toBe(false);
    expect(existsSync(join(root, "backlog", "new-name.md"))).toBe(true);
    const shown = JSON.parse(stdout(await harness.runCli(["show", "new-name", "--json"])));
    expect(shown.task.key).toBe("TSK-1");
    await harness.dispose();
  });

  it("update --key переименовывает задачу на доске, --no-key в main отвергается", async () => {
    const harness = fileHost();
    const filePath = writeKeylessFile("backlog", "hand-written", "Hand written");

    expect(stdout(await harness.runCli(["update", "hand-written", "--key", "TSK-7"]))).toBe(
      "Updated TSK-7  Hand written",
    );
    expect(readFileSync(filePath, "utf8")).toContain("key: TSK-7");

    // В main имя на доске есть у каждой задачи: снятое, оно вернулось бы
    // первой же записью, поэтому просьба отвергается сразу (BBPL-294).
    await expect(harness.runCli(["update", "TSK-7", "--no-key"])).resolves.toMatchObject({
      exitCode: 1,
      stderr:
        "снять ключ можно только у задачи, живущей в ветке: в main имя на доске есть у каждой задачи",
    });
    expect(readFileSync(filePath, "utf8")).toContain("key: TSK-7");
    await harness.dispose();
  });

  it("update отказывает, когда --key и --no-key даны вместе", async () => {
    const harness = fileHost();
    await tasks.createTask({ projectId: BOARD.id, title: "T" });
    await expect(harness.runCli(["update", "TSK-1", "--key", "TSK-9", "--no-key"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--key and --no-key cannot be combined",
    });
    await harness.dispose();
  });

  it("create и update пишут время и деньги флагами, --no-… снимает значение", async () => {
    const harness = fileHost();

    stdout(await harness.runCli([
      "create", "--project", "TSK", "--title", "Priced",
      "--type", "feature", "--estimate", "m", "--check", "test",
      "--minutes", "90", "--budget", "34.1", "--limit", "60",
    ]));
    let shown = JSON.parse(stdout(await harness.runCli(["show", "TSK-1", "--json"])));
    expect(shown.task).toMatchObject({ plannedMinutes: 90, actualMinutes: null, budget: 34.1, budgetLimit: 60, cost: null });

    stdout(await harness.runCli(["update", "TSK-1", "--minutes-actual", "120", "--cost", "41.5", "--no-limit"]));
    shown = JSON.parse(stdout(await harness.runCli(["show", "TSK-1", "--json"])));
    expect(shown.task).toMatchObject({ plannedMinutes: 90, actualMinutes: 120, budget: 34.1, budgetLimit: null, cost: 41.5 });
    expect(readFileSync(shown.task.source.filePath, "utf8")).toContain("minutes_actual: 120");
    await harness.dispose();
  });

  it("create без времени и бюджета предупреждает, что процессные поля пусты", async () => {
    const harness = fileHost();
    const result = await harness.runCli([
      "create", "--project", "TSK", "--title", "Unpriced",
      "--type", "feature", "--estimate", "m", "--check", "test",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Warning: missing process fields: minutes, budget");
    await harness.dispose();
  });

  it("отвергает старые флаги токенов и дробные минуты", async () => {
    const harness = fileHost();
    await tasks.createTask({ projectId: BOARD.id, title: "T" });
    await expect(harness.runCli(["update", "TSK-1", "--plan-tokens", "100"])).resolves.toMatchObject({ exitCode: 1 });
    await expect(harness.runCli(["update", "TSK-1", "--minutes", "1.5"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--minutes must be a non-negative integer",
    });
    await expect(harness.runCli(["update", "TSK-1", "--cost", "-2"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--cost must be a non-negative amount in dollars",
    });
    await harness.dispose();
  });

  it("delete без --yes отказывает и файл остаётся", async () => {
    const harness = fileHost();
    const created = await tasks.createTask({ projectId: BOARD.id, title: "Doomed" });

    await expect(harness.runCli(["delete", "TSK-1"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "delete removes the task file for good; re-run with --yes",
    });
    expect(existsSync((await tasks.getTask(created.id))!.source!.filePath)).toBe(true);
    await harness.dispose();
  });

  it("delete --yes стирает файл, задача больше не находится", async () => {
    const harness = fileHost();
    const created = await tasks.createTask({ projectId: BOARD.id, title: "Doomed" });
    const filePath = (await tasks.getTask(created.id))!.source!.filePath;

    expect(stdout(await harness.runCli(["delete", "TSK-1", "--yes"]))).toBe(`Deleted TSK-1  Doomed (${filePath})`);
    expect(existsSync(filePath)).toBe(false);
    await expect(harness.runCli(["show", "TSK-1"])).resolves.toMatchObject({ exitCode: 1 });
    await harness.dispose();
  });
});

describe("bb tasks CLI: исполнитель и эпик", () => {
  it("create кладёт задачу в папку исполнителя и эпика, show их показывает", async () => {
    const harness = fileHost();

    stdout(await harness.runCli(["create", "--project", "TSK", "--title", "Deep", "--assignee", "Claude", "--epic", "Tasks+"]));

    expect(existsSync(join(root, "Claude", "Tasks+", "backlog", "deep.md"))).toBe(true);
    const text = stdout(await harness.runCli(["show", "TSK-1"]));
    expect(text).toMatch(/Assignee\s+Claude/);
    expect(text).toMatch(/Epic\s+Tasks\+/);
    await harness.dispose();
  });

  it("update --assignee/--epic переносит файл, --no-assignee возвращает в корень без эпика", async () => {
    const harness = fileHost();
    await tasks.createTask({ projectId: BOARD.id, title: "Move" });

    stdout(await harness.runCli(["update", "TSK-1", "--assignee", "Claude", "--epic", "Flow"]));
    expect(JSON.parse(stdout(await harness.runCli(["show", "TSK-1", "--json"]))).task).toMatchObject({ assignee: "Claude", epic: "Flow" });

    stdout(await harness.runCli(["update", "TSK-1", "--no-epic"]));
    expect(existsSync(join(root, "Claude", "backlog", "move.md"))).toBe(true);

    stdout(await harness.runCli(["update", "TSK-1", "--no-assignee"]));
    expect(JSON.parse(stdout(await harness.runCli(["show", "TSK-1", "--json"]))).task).toMatchObject({ assignee: null, epic: null });
    expect(existsSync(join(root, "backlog", "move.md"))).toBe(true);
    await harness.dispose();
  });

  it("update отказывает, когда --epic и --no-epic даны вместе", async () => {
    const harness = fileHost();
    await tasks.createTask({ projectId: BOARD.id, title: "T" });
    await expect(harness.runCli(["update", "TSK-1", "--epic", "A", "--no-epic"])).resolves.toMatchObject({
      exitCode: 1,
      stderr: "--epic and --no-epic cannot be combined",
    });
    await harness.dispose();
  });
});
