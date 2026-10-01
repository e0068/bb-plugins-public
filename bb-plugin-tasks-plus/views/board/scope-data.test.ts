import { describe, expect, it } from "vitest";
import type { TasksRpc } from "../../client/data.js";
import type { Task } from "../../shared/contract.js";
import { boardKey, scopeBoardKey } from "./board-preference.js";
import { fetchScopeBoard, fetchScopeBurndowns, fetchScopeGantt, scopeQuery } from "./scope-data.js";

function task(n: number, projectId: string): Task {
  return {
    id: `${projectId}-T${n}`,
    projectId,
    number: n,
    key: `${projectId}-${n}`,
    title: `Task ${n}`,
    description: "",
    status: "todo",
    priority: "none",
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    position: n,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [],
    source: null,
  } as Task;
}

type Call = { method: string; input: Record<string, unknown> };

function fakeRpc(handlers: Record<string, (input: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const rpc = {
    call: async (method: string, input: Record<string, unknown> = {}) => {
      calls.push({ method, input });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected call ${method}`);
      return handler(input);
    },
  } as unknown as TasksRpc;
  return { rpc, calls };
}

const TASKS = [task(1, "P1"), task(2, "P2"), task(3, "P1")];

describe("board keys per screen", () => {
  it("a project's board keeps its old key; cross-project boards get their own", () => {
    expect(scopeBoardKey("project:P1", null)).toBe(boardKey("P1", null));
    expect(scopeBoardKey("project:P1", "V1")).toBe(boardKey("P1", "V1"));
    expect(scopeBoardKey("all", null)).toBe("board:@all");
    expect(scopeBoardKey("active", null)).toBe("board:@active");
    expect(scopeBoardKey("waiting", "V2")).toBe("board:@waiting#V2");
  });
});

describe("a board reads the tasks of its screen", () => {
  it("all reads every project, active and waiting narrow on the server", async () => {
    expect(scopeQuery("all")).toEqual({});
    expect(scopeQuery("active")).toEqual({ activeOnly: true });
    expect(scopeQuery("waiting")).toEqual({ waitingOnly: true });
    expect(scopeQuery("project:P1")).toEqual({ projectId: "P1" });

    const { rpc, calls } = fakeRpc({
      listTasks: () => ({ tasks: TASKS, nextCursor: null }),
      listLabels: () => ({ labels: [] }),
    });
    const board = await fetchScopeBoard(rpc, "active");
    expect(board.tasks.map((t) => t.key)).toEqual(["P1-1", "P2-2", "P1-3"]);
    const listCall = calls.find((call) => call.method === "listTasks")!;
    expect(listCall.input.activeOnly).toBe(true);
    expect(listCall.input.projectId).toBeUndefined();
  });

  it("labels come from every project on screen; one failing project leaves the rest", async () => {
    const { rpc, calls } = fakeRpc({
      listTasks: () => ({ tasks: TASKS, nextCursor: null }),
      listLabels: (input) => {
        if (input.projectId === "P2") throw new Error("boom");
        return { labels: [{ id: "L1", projectId: "P1", name: "ui", color: "red", createdAt: "2026-07-15T00:00:00.000Z" }] };
      },
    });
    const board = await fetchScopeBoard(rpc, "all");
    const asked = calls.filter((call) => call.method === "listLabels").map((call) => call.input.projectId).sort();
    expect(asked).toEqual(["P1", "P2"]);
    expect(board.labels.map((label) => label.id)).toEqual(["L1"]);
    expect(board.labelsById.get("L1")?.name).toBe("ui");
  });
});

describe("card charts across projects", () => {
  it("burndowns of two projects are merged; gantt asks for every project", async () => {
    const { rpc, calls } = fakeRpc({
      taskBurndowns: (input) => ({
        burndowns: [{ taskId: `${String(input.projectId)}-T1`, open: [1], ends: [0], forecastDays: null }],
      }),
      ganttRows: () => ({ rows: [] }),
    });
    const burndowns = await fetchScopeBurndowns(rpc, ["P1", "P2"], 14);
    expect([...burndowns.keys()].sort()).toEqual(["P1-T1", "P2-T1"]);
    await fetchScopeGantt(rpc, ["P1", "P2"], 14);
    const gantt = calls.find((call) => call.method === "ganttRows")!;
    expect([...(gantt.input.projectIds as string[])].sort()).toEqual(["P1", "P2"]);
  });
});
