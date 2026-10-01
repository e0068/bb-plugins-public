// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
const app = await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { applyFieldDisplay, loadFieldDisplay, moveField, setTaskOpening, taskOpeningOf } = await import(
  "./row-field-preference.js"
);

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const BOARD = `board:${PROJECT_ID}` as const;

const project = {
  id: PROJECT_ID,
  name: "Tasks Plugin",
  prefix: "TSK",
  nextTaskNumber: 9,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

const task: Task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZT4",
  projectId: PROJECT_ID,
  number: 4,
  key: "TSK-4",
  title: "Ship the side panel",
  description: "Задача открывается сбоку.",
  status: "todo",
  priority: "none",
  dueDate: null,
  startDate: null,
  parentTaskId: null,
  position: 4,
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
};

const rpc = {
  listProjects: () => ({ projects: [project] }),
  listFolders: () => ({ folders: [] }),
  listPresets: () => ({ presets: [] }),
  sidebarSummary: () => ({ projects: [] }),
  listLabels: () => ({ labels: [] }),
  listSavedViews: () => ({ savedViews: [] }),
  listTasks: () => ({ tasks: [task] }),
  taskCardMeta: () => ({ cards: [] }),
  listTaskThreads: () => ({ taskThreads: [] }),
};

function renderView(view: "board" | "list", hostHasPanel = true) {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: `${PROJECT_ID}?view=${view}` },
    { rpc, experimental_openFixedTab: () => hostHasPanel },
  );
}

const openDisplayMenu = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Display" }));
  return within(await screen.findByRole("complementary", { name: "Display" }));
};

/** The field list of the open Display panel. */
const openFieldList = async () => within((await openDisplayMenu()).getByRole("group", { name: "Fields" }));

const TASK_TAB_OPEN = { surface: { kind: "current" }, panelId: "tasks", tabId: "task", target: { taskKey: "TSK-4" } };
const TASK_ROUTE = { method: "toPluginPanel", path: "tasks", options: { subPath: "task/TSK-4" } };

describe("Description in the board's Display menu", () => {
  it("is an entry of the field list, draggable like the others, and the separate Show description row is gone", async () => {
    const slot = renderView("board");
    await waitFor(() => slot.getByTitle("Key: TSK-4"));
    const menu = await openFieldList();
    const description = menu.getByRole("button", { name: "Description" });
    const priority = menu.getByRole("button", { name: "Priority" });
    expect(description.compareDocumentPosition(priority) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(menu.getByRole("button", { name: "Reorder Description" })).toBeDefined();
    expect(menu.queryByRole("button", { name: "Show description" })).toBeNull();
  });

  it("shows the description on the cards when turned on, and hides it when turned off", async () => {
    const slot = renderView("board");
    await waitFor(() => slot.getByTitle("Key: TSK-4"));
    const menu = await openFieldList();
    fireEvent.click(menu.getByRole("button", { name: "Description" }));
    await waitFor(() => slot.getByText("Задача открывается сбоку."));
    fireEvent.click(menu.getByRole("button", { name: "Description" }));
    await waitFor(() => expect(slot.queryByText("Задача открывается сбоку.")).toBeNull());
  });

  it("keeps its place when dragged elsewhere in the order", () => {
    const from = loadFieldDisplay(BOARD).fields.map((entry) => entry.field).indexOf("description");
    moveField(BOARD, from, from + 2);
    expect(loadFieldDisplay(BOARD).fields.map((entry) => entry.field).indexOf("description")).toBe(from + 2);
  });

  it("stays on, right under the title, on a board that turned Show description on before it was a field", async () => {
    applyFieldDisplay(BOARD, {
      fields: [{ field: "key", visible: true }],
      showEmpty: false,
      showDescription: true,
    });
    const fields = loadFieldDisplay(BOARD).fields;
    expect(fields[fields.findIndex((entry) => entry.field === "title") + 1]).toEqual({ field: "description", visible: true });
    const slot = renderView("board");
    await waitFor(() => slot.getByText("Задача открывается сбоку."));
  });
});

describe("Open in side panel", () => {
  it("opens a board card in the page's right panel and leaves the board in place once turned on", async () => {
    const slot = renderView("board");
    await waitFor(() => slot.getByTitle("Key: TSK-4"));
    const menu = await openDisplayMenu();
    fireEvent.click(menu.getByRole("button", { name: "Open in side panel" }));
    fireEvent.click(slot.getByText("Ship the side panel"));
    expect(slot.experimental_fixedTabOpenCalls).toEqual([TASK_TAB_OPEN]);
    expect(slot.navigateCalls).not.toContainEqual(TASK_ROUTE);
  });

  it("is a choice of the board or list it was made on, not of the whole plugin", async () => {
    const board = renderView("board");
    await waitFor(() => board.getByTitle("Key: TSK-4"));
    fireEvent.click((await openDisplayMenu()).getByRole("button", { name: "Open in side panel" }));
    cleanup();

    const list = renderView("list");
    fireEvent.click(await list.findByRole("button", { name: "Open TSK-4: Ship the side panel" }));
    expect(list.experimental_fixedTabOpenCalls).toEqual([]);
    expect(list.navigateCalls).toContainEqual(TASK_ROUTE);
  });

  it("opens a list row in the right panel once turned on in the list's own menu", async () => {
    const list = renderView("list");
    const row = await list.findByRole("button", { name: "Open TSK-4: Ship the side panel" });
    fireEvent.click((await openDisplayMenu()).getByRole("button", { name: "Open in side panel" }));
    fireEvent.click(row);
    expect(list.experimental_fixedTabOpenCalls).toEqual([TASK_TAB_OPEN]);
    expect(list.navigateCalls).not.toContainEqual(TASK_ROUTE);
  });

  it("opens the task in the main container while turned off, as before", async () => {
    const slot = renderView("board");
    await waitFor(() => slot.getByTitle("Key: TSK-4"));
    fireEvent.click(slot.getByText("Ship the side panel"));
    expect(slot.experimental_fixedTabOpenCalls).toEqual([]);
    expect(slot.navigateCalls).toContainEqual(TASK_ROUTE);
  });

  it("falls back to the main container when the host has no right panel to open", async () => {
    const slot = renderView("board", false);
    await waitFor(() => slot.getByTitle("Key: TSK-4"));
    fireEvent.click((await openDisplayMenu()).getByRole("button", { name: "Open in side panel" }));
    fireEvent.click(slot.getByText("Ship the side panel"));
    expect(slot.navigateCalls).toContainEqual(TASK_ROUTE);
  });

  it("travels with the board's display config, so a saved view carries it", () => {
    setTaskOpening(BOARD, "side-panel");
    expect(taskOpeningOf(loadFieldDisplay(BOARD))).toBe("side-panel");
    expect(taskOpeningOf(loadFieldDisplay("board:another-project"))).toBe("main");
  });
});

describe("the Task tab of the right panel", () => {
  const taskTab = () => app.navPanels[0]!.fixedTabs!.find((tab) => tab.id === "task")!;

  it("asks for the task it was opened with", async () => {
    const slot = renderSlot(
      taskTab(),
      { subPath: "" },
      {
        rpc: { ...rpc, getTaskByKey: () => ({ task }), getTask: () => ({ task: null }) },
        experimental_fixedTabTarget: { panelId: "tasks", tabId: "task", target: { taskKey: "TSK-4" } },
      },
    );
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual(
        expect.objectContaining({ method: "getTaskByKey", input: expect.objectContaining({ taskKey: "TSK-4" }) }),
      ),
    );
  });

  it("says how to fill it while no task was opened", () => {
    const slot = renderSlot(taskTab(), { subPath: "" }, { rpc });
    expect(slot.getByText("Click a task with Open in side panel on to view it here.")).toBeDefined();
  });
});
