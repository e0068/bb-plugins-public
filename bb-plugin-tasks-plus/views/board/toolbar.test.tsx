// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { SavedView, Task } from "../../shared/contract.js";

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

const app = await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { boardKey, DEFAULT_BOARD_LAYOUT, setBoardLayout } = await import("./board-preference.js");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const VIEW_ID = "01HZZZZZZZZZZZZZZZZZZZZZV1";

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

function task(number: number, patch: Partial<Task> = {}): Task {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
    projectId: PROJECT_ID,
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

const tasks = [task(1, { priority: "high" }), task(2, { priority: "low", status: "done" })];

const boardView: SavedView = {
  id: VIEW_ID,
  version: 2,
  name: "Hot",
  projectId: PROJECT_ID,
  listScope: null,
  surface: "board",
  table: null,
  filters: DEFAULT_BOARD_LAYOUT.filters,
  sort: "manual",
  fields: { fields: [], showEmpty: false, showDescription: false },
  board: DEFAULT_BOARD_LAYOUT.grouping,
  createdAt: "2026-07-01T00:00:00.000Z",
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
        listSavedViews: () => ({ savedViews: [boardView] }),
        listTasks: () => ({ tasks }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listComments: () => ({ comments: [] }),
        listAttachments: () => ({ attachments: [] }),
        ...rpc,
      },
    },
  );
}

const renderBoard = (rpc?: Record<string, (...args: never[]) => unknown>) =>
  render(`${PROJECT_ID}?view=board`, rpc);

const columnKeys = () =>
  Array.from(document.querySelectorAll("[data-board-column]")).map((column) =>
    column.getAttribute("data-board-column"),
  );

const openMenu = (name: string) => fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });

describe("board controls in the topbar", () => {
  it("filters the board by a value picked from Filter", async () => {
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-2"));
    openMenu("Filter");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Priority/ }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: /High/ }));
    await waitFor(() => expect(slot.queryByText("TSK-2")).toBeNull());
    expect(slot.container.querySelector('[data-filter-chip="priorities"]')?.textContent).toContain("High");
  });

  it("drops a filter with the cross on its chip", async () => {
    setBoardLayout(boardKey(PROJECT_ID, null), {
      ...DEFAULT_BOARD_LAYOUT,
      filters: { ...DEFAULT_BOARD_LAYOUT.filters, priorities: ["high"] },
    });
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-1"));
    expect(slot.queryByText("TSK-2")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Remove Priority filter" }));
    await waitFor(() => slot.getByText("TSK-2"));
  });

  it("regroups the board from the Display panel", async () => {
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-1"));
    fireEvent.click(slot.getByRole("button", { name: "Display" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Group by" })).getByRole("button", { name: "Priority" }));
    await waitFor(() => expect(columnKeys()).toEqual(["urgent", "high", "medium", "low", "none"]));
  });

  it("hides a column from the Display panel", async () => {
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-1"));
    fireEvent.click(slot.getByRole("button", { name: "Display" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hide Done column" }));
    await waitFor(() => expect(columnKeys()).not.toContain("done"));
  });

  it("saves the project's board as a board view", async () => {
    setBoardLayout(boardKey(PROJECT_ID, null), {
      ...DEFAULT_BOARD_LAYOUT,
      filters: { ...DEFAULT_BOARD_LAYOUT.filters, priorities: ["high"] },
    });
    const createSavedView = vi.fn((input: Record<string, unknown>) => ({
      savedView: { ...boardView, id: "01HZZZZZZZZZZZZZZZZZZZZZV2", ...input },
    }));
    const slot = renderBoard({ createSavedView });
    await waitFor(() => slot.getByText("TSK-1"));
    fireEvent.click(slot.getByRole("button", { name: "Save view" }));
    const name = await screen.findByRole("textbox", { name: "View name" });
    fireEvent.change(name, { target: { value: "Only high" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(createSavedView).toHaveBeenCalledTimes(1));
    expect(createSavedView.mock.calls[0]![0]).toMatchObject({
      name: "Only high",
      projectId: PROJECT_ID,
      surface: "board",
      filters: { priorities: ["high"] },
      board: { groupBy: "status" },
    });
  });

  it("offers Reset and Save once an open board view changes, and Save writes it", async () => {
    const createSavedView = vi.fn(() => ({ savedView: boardView }));
    const slot = render(`view/${VIEW_ID}`, { createSavedView });
    await waitFor(() => slot.getByText("TSK-1"));
    expect(slot.container.querySelector("header")?.textContent).toContain("Hot");
    expect(slot.queryByRole("button", { name: "Save" })).toBeNull();
    act(() =>
      setBoardLayout(boardKey(PROJECT_ID, VIEW_ID), {
        ...DEFAULT_BOARD_LAYOUT,
        filters: { ...DEFAULT_BOARD_LAYOUT.filters, priorities: ["high"] },
      }),
    );
    fireEvent.click(await slot.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(createSavedView).toHaveBeenCalledTimes(1));
    expect(createSavedView.mock.calls[0]).toEqual([
      expect.objectContaining({ name: "Hot", surface: "board", filters: expect.objectContaining({ priorities: ["high"] }) }),
    ]);
    fireEvent.click(slot.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(slot.queryByRole("button", { name: "Save" })).toBeNull());
    await waitFor(() => slot.getByText("TSK-2"));
  });

  it("opens a board view as a board, leaving the project's board as it was", async () => {
    const slot = render(`view/${VIEW_ID}`);
    await waitFor(() => slot.getByText("TSK-1"));
    expect(columnKeys()).toContain("todo");
  });

});

describe("saving an open board view", () => {
  it("says why Save failed and keeps Save and Reset", async () => {
    const createSavedView = vi.fn(() => Promise.reject(new Error("disk is full")));
    const slot = render(`view/${VIEW_ID}`, { createSavedView });
    await waitFor(() => slot.getByText("TSK-1"));
    act(() =>
      setBoardLayout(boardKey(PROJECT_ID, VIEW_ID), {
        ...DEFAULT_BOARD_LAYOUT,
        filters: { ...DEFAULT_BOARD_LAYOUT.filters, priorities: ["high"] },
      }),
    );
    fireEvent.click(await slot.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(slot.container.querySelector("header")?.textContent).toContain("disk is full"));
    expect(slot.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Reset" })).toBeTruthy();
  });
});
