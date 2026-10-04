// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task } from "../../shared/contract.js";

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
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { TableView } = await import("./index.js");
const { TasksRefreshProvider } = await import("../../client/refresh.js");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const P1 = "01HZZZZZZZZZZZZZZZZZZZZZP1";

const project = (id: string, name: string, prefix: string) => ({
  id,
  name,
  prefix,
  nextTaskNumber: 9,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
});

function task(projectId: string, prefix: string, number: number, patch: Partial<Task> = {}): Task {
  return {
    id: `${projectId.slice(0, 24)}T${number}`,
    projectId,
    number,
    key: `${prefix}-${number}`,
    title: `${prefix} task ${number}`,
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
    ...patch,
  };
}

const parent = task(P1, "TSK", 1, { dueDate: "2026-10-09" });
const TASKS = [task(P1, "TSK", 1), task(P1, "TSK", 2, { status: "done" })];

function renderTable() {
  return renderSlot(
    {
      component: () => (
        <TasksRefreshProvider>
          <TableView scope="all" />
        </TasksRefreshProvider>
      ),
    },
    {},
    {
      rpc: {
        listProjects: () => ({ projects: [project(P1, "Tasks Plugin", "TSK")] }),
        listFolders: () => ({ folders: [] }),
        listLabels: () => ({ labels: [] }),
        listTasks: () => ({ tasks: TASKS, nextCursor: null }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listSavedViews: () => ({ savedViews: [] }),
      } as never,
    },
  );
}

// A long table restyled whole on every change of the page held the browser
// for over half a second each time — a filter chip's menu came seconds late.
describe("a task row of the table", () => {
  it("is skipped by the browser's styling and layout while off the screen, keeping its height", async () => {
    const slot = renderTable();
    await waitFor(() => expect(slot.container.querySelectorAll("[data-task-key]")).toHaveLength(TASKS.length));
    for (const row of Array.from(slot.container.querySelectorAll<HTMLElement>("[data-task-key]"))) {
      expect(row.style.contentVisibility).toBe("auto");
      expect(row.style.containIntrinsicSize).toBe("auto 34px");
    }
  });
});
