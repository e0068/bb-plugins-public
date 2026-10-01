// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task } from "../../shared/contract.js";
import type { BoardGroupBy } from "../../shared/enums.js";

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
// jsdom has no PointerEvent; a MouseEvent carries the coordinates the board reads.
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

/**
 * jsdom lays nothing out, so the board's geometry is given here: column i
 * spans x from 300·i to 300·i + 230, cards sit at the top, and everything
 * else covers the screen.
 */
Element.prototype.getBoundingClientRect = function (this: Element) {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  const column = this.getAttribute("data-board-column");
  if (column !== null) {
    const columns = Array.from(document.querySelectorAll("[data-board-column]"));
    return rect(columns.indexOf(this) * 300, 0, 230, 800);
  }
  if (this.hasAttribute("data-task-key")) return rect(0, 0, 230, 40);
  return rect(0, 0, 5000, 1000);
};

const app = await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { boardKey, DEFAULT_BOARD_LAYOUT, loadBoardLayout, setBoardLayout } = await import(
  "./board-preference.js"
);

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const KEY = boardKey(PROJECT_ID, null);

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

function renderBoard(rpc: Record<string, (...args: never[]) => unknown> = {}) {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: `${PROJECT_ID}?view=board` },
    {
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: [] }),
        listSavedViews: () => ({ savedViews: [] }),
        listTasks: () => ({ tasks }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        ...rpc,
      },
    },
  );
}

const groupBy = (by: BoardGroupBy) =>
  setBoardLayout(KEY, { ...DEFAULT_BOARD_LAYOUT, grouping: { groupBy: by, columns: {}, hideEmpty: false } });

const columnKeys = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-board-column]")).map((column) =>
    column.getAttribute("data-board-column"),
  );

describe("a board laid out by its layout", () => {
  it("draws a column per priority when grouped by priority", async () => {
    groupBy("priority");
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-1"));
    expect(columnKeys(slot.container)).toEqual(["urgent", "high", "medium", "low", "none"]);
  });

  it("shows only the cards the filters let through", async () => {
    setBoardLayout(KEY, {
      ...DEFAULT_BOARD_LAYOUT,
      filters: { ...DEFAULT_BOARD_LAYOUT.filters, priorities: ["high"] },
    });
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-1"));
    expect(slot.queryByText("TSK-2")).toBeNull();
  });

  it("lays the cards out in one grid when nothing groups the board", async () => {
    groupBy("none");
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-1"));
    expect(columnKeys(slot.container)).toEqual([]);
    const grid = slot.container.querySelector("[data-board-grid]");
    expect(grid?.textContent).toContain("TSK-1");
    expect(grid?.textContent).toContain("TSK-2");
  });

  it("says when the filters leave nothing, and clears them", async () => {
    setBoardLayout(KEY, {
      ...DEFAULT_BOARD_LAYOUT,
      filters: { ...DEFAULT_BOARD_LAYOUT.filters, priorities: ["urgent"] },
    });
    const slot = renderBoard();
    await waitFor(() => slot.getByText("No tasks match these filters"));
    fireEvent.click(slot.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => slot.getByText("TSK-1"));
    expect(loadBoardLayout(KEY).filters.priorities).toEqual([]);
  });

  it("keeps a column as wide as it was dragged", async () => {
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-1"));
    const handle = slot.getByRole("separator", { name: "Resize Todo column" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 190 });
    fireEvent.pointerUp(window, { clientX: 190 });
    await waitFor(() =>
      expect(loadBoardLayout(KEY).grouping.columns.status?.widths.todo).toBe(320),
    );
  });

  it("sets the grouped property when a card is dropped into another column", async () => {
    groupBy("priority");
    const updateTask = vi.fn(() => ({ ok: true, task: { ...tasks[0]!, priority: "medium" } }));
    const slot = renderBoard({ updateTask });
    await waitFor(() => slot.getByText("TSK-1"));
    const card = slot.container.querySelector('[data-task-key="TSK-1"]')!;
    fireEvent.pointerDown(card, { button: 0, clientX: 310, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 620, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 620, clientY: 100 });
    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    expect(updateTask.mock.calls[0]).toEqual([
      expect.objectContaining({ taskId: tasks[0]!.id, priority: "medium" }),
    ]);
  });
});

describe("reordering cards inside a status column", () => {
  const todo = [task(1), task(2), task(3)];
  const dragInTodo = (container: HTMLElement) => {
    const card = container.querySelector('[data-task-key="TSK-1"]')!;
    // Todo is the second column: x 300–530. Every card's center is at y 20,
    // so a pointer at y 100 drops below the last card.
    fireEvent.pointerDown(card, { button: 0, clientX: 310, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 320, clientY: 60 });
    fireEvent.pointerMove(window, { clientX: 320, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 320, clientY: 100 });
  };
  const cardsInTodo = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-board-column="todo"] [data-task-key]')).map((card) =>
      card.getAttribute("data-task-key"),
    );

  it("moves the card in manual order and tells the server its neighbours", async () => {
    const boardMove = vi.fn(() => new Promise(() => {}));
    const slot = renderBoard({ listTasks: () => ({ tasks: todo }), boardMove });
    await waitFor(() => slot.getByText("TSK-3"));
    dragInTodo(slot.container);
    await waitFor(() => expect(boardMove).toHaveBeenCalledTimes(1));
    expect(boardMove.mock.calls[0]).toEqual([
      expect.objectContaining({
        taskId: todo[0]!.id,
        status: "todo",
        beforeTaskId: todo[2]!.id,
        afterTaskId: null,
      }),
    ]);
    // Drawn in its new place before the server answers.
    expect(cardsInTodo(slot.container)).toEqual(["TSK-2", "TSK-3", "TSK-1"]);
  });

  it("leaves the order to the sort when one is chosen", async () => {
    setBoardLayout(KEY, { ...DEFAULT_BOARD_LAYOUT, sort: "priority" });
    const boardMove = vi.fn(() => new Promise(() => {}));
    const slot = renderBoard({ listTasks: () => ({ tasks: todo }), boardMove });
    await waitFor(() => slot.getByText("TSK-3"));
    dragInTodo(slot.container);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(boardMove).not.toHaveBeenCalled();
  });
});
