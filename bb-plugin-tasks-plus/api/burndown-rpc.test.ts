import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StatusTransition } from "../db/transition-log.js";
import { createFileTasksStore } from "../filesync/store.js";
import type { BoardConfig, KvStore } from "../filesync/board-config.js";
import { tasksRpcContract } from "../shared/contract.js";
import { registerTasksApi, type TasksApiStore } from ".";

// A card's burndown: the tasks under it still open at the end of each column
// of the board's period, one call for the whole board.

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
let log: StatusTransition[];
let call: (input: unknown) => Promise<unknown>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "burndown-rpc-"));
  tasks = createFileTasksStore(fakeKv(), [BOARD], [], [], [], () => {});
  tasks.setBoardRoots(BOARD.id, [{ absPath: root, origin: { kind: "main" } }]);
  log = [];
  const store: TasksApiStore = {
    tasks,
    transitions: {
      record(transition) {
        log.push(transition);
      },
      range: (fromMs, toMs) => log.filter((entry) => entry.atMs >= fromMs && entry.atMs < toMs),
      firstAtMs: () => log[0]?.atMs ?? null,
    },
    transaction: (operation) => tasks.transaction(operation),
    projectTaskCount: async () => 0,
    projectPrefixExists: () => false,
    openTaskCount: async () => 0,
    sidebarSummary: async () => [],
  };
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  registerTasksApi(bb, store, { get: async () => null });
  call = (input) => harness.behavior.callRpc("taskBurndowns", input);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const DAY = 86_400_000;

describe("taskBurndowns RPC by period", () => {
  it("refuses a call without a period", async () => {
    await expect(call({ projectId: BOARD.id, days: 14 })).rejects.toThrow();
  });
});

describe("taskBurndowns RPC by a period in days", () => {
  it("reads a period of days day by day and hands back the ends it read at", async () => {
    const epic = await tasks.createTask({ projectId: BOARD.id, title: "Flow", type: "epic" });
    await tasks.createTask({ projectId: BOARD.id, title: "Child", parentTaskId: epic.id });
    // The last end is the call's own now: a task made in the same millisecond is not before it.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const result = tasksRpcContract.taskBurndowns.output.parse(await call({ projectId: BOARD.id, period: 14 }));

    const burndown = result.burndowns.find((entry) => entry.taskId === epic.id)!;
    expect(burndown.open).toHaveLength(15);
    expect(burndown.ends).toHaveLength(15);
    expect(burndown.ends[14]! - burndown.ends[0]!).toBe(14 * DAY);
    expect(burndown.open.at(-1)).toBe(1);
  });

  it("reads a period of 0 — all time — week by week from the card's oldest sub-task", async () => {
    const epic = await tasks.createTask({ projectId: BOARD.id, title: "Flow", type: "epic" });
    await tasks.createTask({ projectId: BOARD.id, title: "Child", parentTaskId: epic.id });

    const result = tasksRpcContract.taskBurndowns.output.parse(await call({ projectId: BOARD.id, period: 0 }));

    const burndown = result.burndowns.find((entry) => entry.taskId === epic.id)!;
    expect(burndown.ends).toHaveLength(2);
    expect(burndown.ends[1]! - burndown.ends[0]!).toBe(7 * DAY);
  });

  it("gives each task the open count of everything under it over the days, leaving out tasks with nothing under them", async () => {
    const epic = await tasks.createTask({ projectId: BOARD.id, title: "Flow", type: "epic" });
    const child = await tasks.createTask({ projectId: BOARD.id, title: "Child", parentTaskId: epic.id });
    const grandchild = await tasks.createTask({ projectId: BOARD.id, title: "Grandchild", parentTaskId: child.id });
    // Made just now; the grandchild's close lands in the log, so only the child still owes work.
    log.push({ taskId: grandchild.id, projectId: BOARD.id, fromStatus: "backlog", toStatus: "done", atMs: Date.now() - 1, actor: null });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const result = tasksRpcContract.taskBurndowns.output.parse(await call({ projectId: BOARD.id, period: 3 }));

    const byTask = new Map(result.burndowns.map((entry) => [entry.taskId, entry.open]));
    expect([...byTask.keys()].sort()).toEqual([epic.id, child.id].sort());
    // Every day end but the last came before the tasks were made.
    expect(byTask.get(epic.id)).toEqual([0, 0, 0, 1]);
    expect(byTask.get(child.id)).toEqual([0, 0, 0, 0]);
  });

  it("refuses a period that is not a whole number of days within the longest", async () => {
    for (const period of [-1, 1.5, 3651, "week"]) {
      await expect(call({ projectId: BOARD.id, period })).rejects.toThrow();
    }
  });
});

describe("taskBurndowns RPC by a period in hours or minutes", () => {
  it("reads a period of hours hour by hour, and of minutes minute by minute", async () => {
    const epic = await tasks.createTask({ projectId: BOARD.id, title: "Flow", type: "epic" });
    await tasks.createTask({ projectId: BOARD.id, title: "Child", parentTaskId: epic.id });

    for (const [unit, unitMs] of [["hours", 3_600_000], ["minutes", 60_000]] as const) {
      const result = tasksRpcContract.taskBurndowns.output.parse(await call({ projectId: BOARD.id, period: 6, unit }));
      const ends = result.burndowns.find((entry) => entry.taskId === epic.id)!.ends;
      expect(ends).toHaveLength(7);
      ends.slice(1).forEach((end, index) => expect(end - ends[index]!).toBe(unitMs));
    }
  });

  it("refuses a unit it does not count by", async () => {
    await expect(call({ projectId: BOARD.id, period: 6, unit: "weeks" })).rejects.toThrow();
  });
});
