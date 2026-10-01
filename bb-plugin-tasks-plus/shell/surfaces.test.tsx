// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task } from "../shared/contract.js";

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
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

const app = await loadPluginApp(() => import("../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { setTableSettings } = await import("../views/table/table-preference.js");
const { setBoardLayout, loadBoardLayout, scopeBoardKey } = await import("../views/board/board-preference.js");
const { loadLayout } = (await import("./view-preference.js")) as unknown as { loadLayout: (key: string) => string };

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const P1 = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const VIEW_TABLE = "01HZZZZZZZZZZZZZZZZZZZZZV1";
const VIEW_BOARD = "01HZZZZZZZZZZZZZZZZZZZZZV2";

const project = {
  id: P1,
  name: "Tasks Plugin",
  prefix: "TSK",
  nextTaskNumber: 9,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

function task(number: number, patch: Partial<Task> = {}): Task {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
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
    ...patch,
  };
}

const tasks = [task(1, { priority: "high", dueDate: "2026-10-09" }), task(2, { priority: "low", dueDate: "2026-10-01" })];

const FILTERS = { statuses: [], priorities: [], types: [], estimates: [], labelNames: [], assignees: [], parents: [] };
const FIELDS = { fields: [], showEmpty: false, showDescription: false };

const tableView = {
  id: VIEW_TABLE,
  version: 2,
  name: "By priority",
  projectId: null,
  listScope: null,
  surface: "table",
  filters: FILTERS,
  sort: "manual",
  fields: FIELDS,
  board: null,
  table: { sort: { column: "dueDate", direction: "asc" }, groupBy: "priority", widths: {}, pinned: ["title"], collapsedGroups: [] },
  createdAt: "2026-07-01T00:00:00.000Z",
};

const boardView = {
  ...tableView,
  id: VIEW_BOARD,
  name: "Board everywhere",
  surface: "board",
  table: null,
  board: { groupBy: "status", columns: {}, hideEmpty: false },
};

function render(subPath: string, rpc: Record<string, (...args: never[]) => unknown> = {}) {
  return renderSlot(
    app.navPanels[0]!,
    { subPath },
    {
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: [] }),
        listSavedViews: () => ({ savedViews: [tableView, boardView] }),
        listTasks: () => ({ tasks, nextCursor: null }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listComments: () => ({ comments: [] }),
        listAttachments: () => ({ attachments: [] }),
        ...rpc,
      } as never,
    },
  );
}

const header = (slot: ReturnType<typeof render>) => within(slot.container.querySelector("header")!);
const isTable = (slot: ReturnType<typeof render>) => slot.queryAllByRole("columnheader").length > 0;
const isBoard = (slot: ReturnType<typeof render>) => slot.container.querySelector("[data-board-column]") !== null;
const openPanel = async (slot: ReturnType<typeof render>) => {
  fireEvent.click(header(slot).getByRole("button", { name: "Display" }));
  return within(await slot.findByRole("complementary", { name: "Display" }));
};

async function saveViewNamed(slot: ReturnType<typeof render>, name: string) {
  fireEvent.click(await header(slot).findByRole("button", { name: "Save view" }));
  const input = await screen.findByRole("textbox", { name: "View name" });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("a saved view carries its table", () => {
  it("saving a table view stores its table settings; opening it puts them back", async () => {
    const createSavedView = vi.fn((input: Record<string, unknown>) => ({ savedView: { ...tableView, id: "01HZZZZZZZZZZZZZZZZZZZZZV3", ...input } }));
    const slot = render("all", { createSavedView });
    await waitFor(() => expect(isTable(slot)).toBe(true));
    act(() => setTableSettings("all", { groupBy: "none" }));
    await saveViewNamed(slot, "Flat");
    await waitFor(() => expect(createSavedView).toHaveBeenCalledTimes(1));
    expect(createSavedView.mock.calls[0]![0]).toMatchObject({ name: "Flat", surface: "table", projectId: null, listScope: null, table: { groupBy: "none" } });
    cleanup();

    const opened = render(`view/${VIEW_TABLE}`);
    await waitFor(() => expect(opened.container.querySelector("[data-table-group]")).not.toBeNull());
    const groups = Array.from(opened.container.querySelectorAll("[data-table-group]")).map((group) => group.getAttribute("data-table-group"));
    expect(groups).toEqual(["high", "low"]);
    expect(opened.getByRole("columnheader", { name: /Due date/ }).getAttribute("aria-sort")).toBe("ascending");
  });
});

describe("a view saved as a list", () => {
  it("opens as a table with its filters and its sort on the very first render", async () => {
    const listView = { ...tableView, surface: "list", table: null, sort: "due", filters: { ...FILTERS, priorities: ["low"] } };
    const slot = render(`view/${VIEW_TABLE}`, { listSavedViews: () => ({ savedViews: [listView] }) });
    await waitFor(() => expect(isTable(slot)).toBe(true));
    await waitFor(() => expect(slot.getByRole("columnheader", { name: /Due date/ }).getAttribute("aria-sort")).toBe("ascending"));
    expect(Array.from(slot.container.querySelectorAll("[data-task-key]")).map((row) => row.getAttribute("data-task-key"))).toEqual(["TSK-2"]);
  });
});

describe("a view saved as a list, on a screen whose table was changed", () => {
  it("opens exactly as saved: its sort in the header, nothing to reset", async () => {
    setTableSettings("all", { widths: { title: 500 }, groupBy: "none", sort: { column: "priority", direction: "desc" } });
    const listView = { ...tableView, surface: "list", table: null, sort: "due", filters: FILTERS };
    const slot = render(`view/${VIEW_TABLE}`, { listSavedViews: () => ({ savedViews: [listView] }) });
    await waitFor(() => expect(isTable(slot)).toBe(true));
    await waitFor(() => expect(slot.getByRole("columnheader", { name: /Due date/ }).getAttribute("aria-sort")).toBe("ascending"));
    expect(header(slot).getByText(/Due date/)).toBeDefined();
    expect(header(slot).queryByRole("button", { name: "Reset" })).toBeNull();
    expect(slot.container.querySelector("[data-table-group]")).not.toBeNull();
  });
});

describe("every task screen opens as a table or a board", () => {
  it("every task screen resolves to a table or a board", async () => {
    for (const subPath of ["all", "active", "waiting", P1, `view/${VIEW_TABLE}`]) {
      const slot = render(subPath);
      await waitFor(() => expect(isTable(slot), subPath).toBe(true));
      cleanup();
    }
    for (const subPath of ["all?view=board", "active?view=board", "waiting?view=board", `${P1}?view=board`, `view/${VIEW_BOARD}`]) {
      const slot = render(subPath);
      await waitFor(() => expect(isBoard(slot), subPath).toBe(true));
      cleanup();
    }
  });

  it("the header names the project of a project board", async () => {
    const projectBoard = render(`${P1}?view=board`);
    await waitFor(() => expect(isBoard(projectBoard)).toBe(true));
    expect(header(projectBoard).getByText("Tasks Plugin")).toBeDefined();
    cleanup();
    const crossBoard = render(`view/${VIEW_BOARD}`);
    await waitFor(() => expect(isBoard(crossBoard)).toBe(true));
    expect(header(crossBoard).getByText("Board everywhere")).toBeDefined();
    expect(header(crossBoard).queryByText("Tasks Plugin")).toBeNull();
  });
});

describe("the header of a table and of a board", () => {
  it("save as view on a table stores a table view", async () => {
    const createSavedView = vi.fn((input: Record<string, unknown>) => ({ savedView: { ...tableView, id: "01HZZZZZZZZZZZZZZZZZZZZZV4", ...input } }));
    const slot = render(P1, { createSavedView });
    await waitFor(() => expect(isTable(slot)).toBe(true));
    fireEvent.keyDown(header(slot).getByRole("button", { name: "Sort" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Due date" }));
    await waitFor(() => expect(slot.getByRole("columnheader", { name: /Due date/ }).getAttribute("aria-sort")).toBe("ascending"));
    await saveViewNamed(slot, "By due");
    await waitFor(() => expect(createSavedView).toHaveBeenCalledTimes(1));
    expect(createSavedView.mock.calls[0]![0]).toMatchObject({
      name: "By due",
      surface: "table",
      projectId: P1,
      table: { sort: { column: "dueDate", direction: "asc" } },
    });
  });

  it("save as view on the All tasks board stores a cross-project board view", async () => {
    const createSavedView = vi.fn((input: Record<string, unknown>) => ({ savedView: { ...boardView, id: "01HZZZZZZZZZZZZZZZZZZZZZV5", ...input } }));
    const slot = render("all?view=board", { createSavedView });
    await waitFor(() => expect(isBoard(slot)).toBe(true));
    const key = scopeBoardKey("all", null);
    act(() => setBoardLayout(key, { ...loadBoardLayout(key), grouping: { groupBy: "priority", columns: {}, hideEmpty: false } }));
    await saveViewNamed(slot, "Priorities everywhere");
    await waitFor(() => expect(createSavedView).toHaveBeenCalledTimes(1));
    expect(createSavedView.mock.calls[0]![0]).toMatchObject({
      name: "Priorities everywhere",
      surface: "board",
      projectId: null,
      listScope: null,
      board: { groupBy: "priority" },
    });
  });
});

describe("Table or Board from Display", () => {
  it("Display offers Table and Board on All tasks, Active, Waiting, a project and a view", async () => {
    for (const subPath of ["all", "active", "waiting", P1, `view/${VIEW_TABLE}`, "all?view=board"]) {
      const slot = render(subPath);
      await waitFor(() => expect(isTable(slot) || isBoard(slot), subPath).toBe(true));
      const panel = await openPanel(slot);
      const layout = within(panel.getByRole("group", { name: "Layout" }));
      expect(layout.getByRole("button", { name: "Table" }), subPath).toBeDefined();
      expect(layout.getByRole("button", { name: "Board" }), subPath).toBeDefined();
      cleanup();
    }
  });

  it("the table's Display groups rows and pins columns", async () => {
    const slot = render("all");
    await waitFor(() => expect(isTable(slot)).toBe(true));
    const panel = await openPanel(slot);
    fireEvent.click(within(panel.getByRole("group", { name: "Group by" })).getByRole("button", { name: "Priority" }));
    await waitFor(() =>
      expect(Array.from(slot.container.querySelectorAll("[data-table-group]")).map((group) => group.getAttribute("data-table-group"))).toEqual(["high", "low"]),
    );
    fireEvent.click(panel.getByRole("button", { name: "Pin Project" }));
    await waitFor(() => expect(slot.getAllByRole("columnheader").map((cell) => cell.textContent?.trim()).slice(0, 2)).toEqual(["Title", "Project"]));
  });

  it("switching to Board on All tasks opens the cross-project board and is remembered", async () => {
    const slot = render("all");
    await waitFor(() => expect(isTable(slot)).toBe(true));
    const panel = await openPanel(slot);
    fireEvent.click(within(panel.getByRole("group", { name: "Layout" })).getByRole("button", { name: "Board" }));
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "tasks", options: { subPath: "all?view=board" } });
    expect(loadLayout("all")).toBe("board");
  });
});
