// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task, TaskThread } from "../../shared/contract.js";

window.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { TableView } = await import("./index.js");
const { TasksRefreshProvider } = await import("../../client/refresh.js");
const { setTableSettings } = await import("./table-preference.js");
const { useTaskListMeta } = await import("../common/data.js");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const P1 = "01HZZZZZZZZZZZZZZZZZZZZZP1";

const task = (number: number): Task =>
  ({
    id: `${P1.slice(0, 24)}T${number}`,
    projectId: P1,
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
    description: "",
    status: "todo",
    priority: "none",
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    position: number,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [],
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    source: null,
  }) as Task;

const thread = (owner: Task, n: number, title: string, patch: Partial<TaskThread> = {}): TaskThread => ({
  id: `rec_${n}` as TaskThread["id"],
  taskId: owner.id as TaskThread["taskId"],
  threadId: `thr_${n}`,
  presetName: "Code",
  title,
  liveStatus: "idle",
  archivedAt: null,
  attachedAt: "2026-10-01T10:00:00.000Z",
  ...patch,
});

const TASKS = [task(1), task(2), task(3)];
const CARDS = [
  { taskId: TASKS[0]!.id, attachmentCount: 0, taskThreads: [thread(TASKS[0]!, 1, "Beta")] },
  { taskId: TASKS[1]!.id, attachmentCount: 0, taskThreads: [thread(TASKS[1]!, 2, "Alpha"), thread(TASKS[1]!, 3, "Working", { liveStatus: "working" }), thread(TASKS[1]!, 4, "Old", { archivedAt: "2026-10-02T10:00:00.000Z" })] },
];

const rpc = {
  listProjects: () => ({ projects: [{ id: P1, name: "Tasks", prefix: "TSK", nextTaskNumber: 9, color: "blue", folderId: null, linkedBbProjectId: null, createdAt: "2026-07-15T00:00:00.000Z" }] }),
  listFolders: () => ({ folders: [] }),
  listLabels: () => ({ labels: [] }),
  listTasks: () => ({ tasks: TASKS, nextCursor: null }),
  taskCardMeta: () => ({ cards: CARDS }),
  listTaskThreads: () => ({ taskThreads: [] }),
  listSavedViews: () => ({ savedViews: [] }),
} as never;

const rowKeys = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-task-key]")).map((row) => row.getAttribute("data-task-key"));

describe("the Assignee field in the task table", () => {
  it("sorts the rows by the titles of their threads, a task with none last", async () => {
    setTableSettings("all", { groupBy: "none", sort: { column: "threads", direction: "asc" } });
    const slot = renderSlot({ component: () => (<TasksRefreshProvider><TableView scope="all" /></TasksRefreshProvider>) }, {}, { rpc });
    await waitFor(() => expect(rowKeys(slot.container)).toEqual(["TSK-2", "TSK-1", "TSK-3"]));
  });

  it("gives a row every thread of its task, the finished and archived ones too, and only the working ones as active", async () => {
    function Probe() {
      const meta = useTaskListMeta(TASKS).data?.get(TASKS[1]!.id);
      return <output>{meta === undefined ? "" : JSON.stringify({ threads: meta.threads.map((t) => t.title), active: meta.activeThreads.map((t) => t.title) })}</output>;
    }
    const slot = renderSlot({ component: () => (<TasksRefreshProvider><Probe /></TasksRefreshProvider>) }, {}, { rpc });
    await waitFor(() => expect(slot.container.textContent).toBe(JSON.stringify({ threads: ["Alpha", "Working", "Old"], active: ["Working"] })));
  });
});
