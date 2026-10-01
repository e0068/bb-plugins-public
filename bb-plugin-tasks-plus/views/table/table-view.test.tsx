// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import type { Task } from "../../shared/contract.js";

// Compact viewport: column menus render as drawers whose items are clickable in jsdom.
window.matchMedia = (query: string) => ({
  matches: query === COMPACT_VIEWPORT_QUERY,
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
const { setTableSettings } = await import("./table-preference.js");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const P1 = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const P2 = "01HZZZZZZZZZZZZZZZZZZZZZP2";

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
const TASKS = [
  parent,
  task(P1, "TSK", 2, { parentTaskId: parent.id, status: "done" }),
  task(P2, "SH", 3, { dueDate: "2026-10-01" }),
  task(P2, "SH", 4, { status: "in_progress" }),
  task(P1, "TSK", 5, { dueDate: "2026-10-05" }),
];

function renderTable(tasks: readonly Task[] = TASKS) {
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
        listProjects: () => ({ projects: [project(P1, "Tasks Plugin", "TSK"), project(P2, "Shader Lab", "SH")] }),
        listFolders: () => ({ folders: [] }),
        listLabels: () => ({ labels: [] }),
        listTasks: () => ({ tasks, nextCursor: null }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listSavedViews: () => ({ savedViews: [] }),
      } as never,
    },
  );
}

const rowKeys = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-task-key]")).map((row) => row.getAttribute("data-task-key"));
const headers = (slot: ReturnType<typeof renderTable>) => slot.getAllByRole("columnheader").map((cell) => cell.textContent?.trim());

async function columnMenu(slot: ReturnType<typeof renderTable>, name: string) {
  const cell = slot.getByRole("columnheader", { name: new RegExp(name) });
  fireEvent.click(within(cell).getByRole("button", { name }));
  // The compact drawer realizes its items a frame after the dialog appears.
  const menu = await slot.findByRole("dialog", { name });
  await within(menu).findAllByRole("menuitem");
  return menu;
}

describe("a screen of tasks as a table", () => {
  it("a screen draws one header per visible field and one row per task", async () => {
    const slot = renderTable();
    await waitFor(() => expect(rowKeys(slot.container)).toHaveLength(TASKS.length));
    const shown = headers(slot);
    expect(shown[0]).toBe("Title");
    for (const name of ["Key", "Project", "Due date"]) expect(shown).toContain(name);
    expect(shown).not.toContain("Description");
  });

  it("rows are grouped by status with counts; a group collapses", async () => {
    const slot = renderTable();
    await waitFor(() => expect(rowKeys(slot.container)).toHaveLength(TASKS.length));
    const groups = Array.from(slot.container.querySelectorAll("[data-table-group]")).map((group) => group.getAttribute("data-table-group"));
    expect(groups).toEqual(["todo", "in_progress"]);
    const todo = slot.container.querySelector('[data-table-group="todo"]') as HTMLElement;
    expect(todo.textContent).toMatch(/Todo\s*4/);
    fireEvent.click(within(todo).getByRole("button", { name: /Todo/ }));
    await waitFor(() => expect(rowKeys(slot.container)).toEqual(["SH-4"]));
  });

  it("a sub-task sits under its parent and hides with it", async () => {
    const slot = renderTable();
    await waitFor(() => expect(rowKeys(slot.container)).toHaveLength(TASKS.length));
    const keys = rowKeys(slot.container);
    expect(keys.indexOf("TSK-2")).toBe(keys.indexOf("TSK-1") + 1);
    const row = slot.container.querySelector('[data-task-key="TSK-1"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Collapse sub-tasks/ }));
    await waitFor(() => expect(rowKeys(slot.container)).not.toContain("TSK-2"));
  });

  it("sorting by due date from the column menu reorders rows within groups", async () => {
    const slot = renderTable();
    await waitFor(() => expect(rowKeys(slot.container)).toHaveLength(TASKS.length));
    expect(rowKeys(slot.container)).toEqual(["TSK-1", "TSK-2", "SH-3", "TSK-5", "SH-4"]);
    fireEvent.click(within(await columnMenu(slot, "Due date")).getByRole("menuitem", { name: "Sort ascending" }));
    await waitFor(() => expect(rowKeys(slot.container)).toEqual(["SH-3", "TSK-5", "TSK-1", "TSK-2", "SH-4"]));
    cleanup();
    const again = renderTable();
    await waitFor(() => expect(rowKeys(again.container)).toEqual(["SH-3", "TSK-5", "TSK-1", "TSK-2", "SH-4"]));
    expect(again.getByRole("columnheader", { name: /Due date/ }).getAttribute("aria-sort")).toBe("ascending");
  });

  it("hiding removes a column; pinning moves it to the front", async () => {
    const slot = renderTable();
    await waitFor(() => expect(rowKeys(slot.container)).toHaveLength(TASKS.length));
    fireEvent.click(within(await columnMenu(slot, "Key")).getByRole("menuitem", { name: "Hide column" }));
    await waitFor(() => expect(headers(slot)).not.toContain("Key"));
    fireEvent.click(within(await columnMenu(slot, "Project")).getByRole("menuitem", { name: "Pin column" }));
    await waitFor(() => expect(headers(slot).slice(0, 2)).toEqual(["Title", "Project"]));
  });

  it("no grouping draws no group headers", async () => {
    setTableSettings("all", { groupBy: "none" });
    const slot = renderTable();
    await waitFor(() => expect(rowKeys(slot.container)).toHaveLength(TASKS.length));
    expect(slot.container.querySelector("[data-table-group]")).toBeNull();
  });

  it("the pinned edge is a divider line in every row, never a shadow", async () => {
    const slot = renderTable();
    await waitFor(() => expect(rowKeys(slot.container)).toHaveLength(TASKS.length));
    for (const row of Array.from(slot.container.querySelectorAll("[data-task-key]"))) {
      const [title, ...rest] = Array.from(row.children);
      expect(title!.className).toMatch(/\bborder-r\b/);
      for (const cell of [title!, ...rest]) expect(cell.className).not.toMatch(/shadow/);
    }
  });

  it("group names and New task rows hold the leading edge while the table scrolls sideways", async () => {
    const slot = renderTable();
    await waitFor(() => expect(rowKeys(slot.container)).toHaveLength(TASKS.length));
    const todo = slot.container.querySelector('[data-table-group="todo"]') as HTMLElement;
    expect(within(todo).getByRole("button", { name: /Todo/ }).className).toMatch(/\bsticky\b.*\bleft-0\b|\bleft-0\b.*\bsticky\b/);
    const newTask = slot.getByRole("button", { name: "Add a task to Todo" });
    expect(within(newTask).getByText("New task").className).toMatch(/\bsticky\b.*\bleft-0\b|\bleft-0\b.*\bsticky\b/);
  });

  it("a group header carries the icon of its value", async () => {
    const slot = renderTable();
    await waitFor(() => expect(rowKeys(slot.container)).toHaveLength(TASKS.length));
    const todo = slot.container.querySelector('[data-table-group="todo"]') as HTMLElement;
    expect(todo.querySelector('[data-status-icon="todo"]')).not.toBeNull();
  });

  it("an empty screen shows the empty state", async () => {
    const slot = renderTable([]);
    await waitFor(() => expect(slot.getByText(/No tasks/)).toBeDefined());
    expect(slot.queryAllByRole("columnheader")).toHaveLength(0);
  });
});
