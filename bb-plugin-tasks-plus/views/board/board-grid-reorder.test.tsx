// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
// jsdom has no PointerEvent; a MouseEvent carries the coordinates the board reads.
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

/**
 * jsdom lays nothing out, so the grid's geometry is given here: its cards
 * stand in one row, card i spanning x from 240·i to 240·i + 230, and
 * everything else covers the screen.
 */
Element.prototype.getBoundingClientRect = function (this: Element) {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  if (this.hasAttribute("data-task-key")) {
    const cards = Array.from(document.querySelectorAll("[data-board-grid] [data-task-key]"));
    return rect(Math.max(0, cards.indexOf(this)) * 240, 0, 230, 40);
  }
  return rect(0, 0, 5000, 1000);
};

const app = await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { boardKey, DEFAULT_BOARD_LAYOUT, setBoardLayout } = await import("./board-preference.js");

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

const tasks = [task(1), task(2, { status: "done" }), task(3, { status: "in_progress" })];

function renderGrid(boardMove: (input: unknown) => unknown) {
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
        boardMove,
      },
    },
  );
}

const ungrouped = (sort: "manual" | "priority") =>
  setBoardLayout(KEY, {
    ...DEFAULT_BOARD_LAYOUT,
    sort,
    grouping: { groupBy: "none", columns: {}, hideEmpty: false },
  });

/** Picks the first card up and lets it go to the right of the last one. */
function dragFirstPastLast(container: HTMLElement) {
  const card = container.querySelector('[data-task-key="TSK-1"]')!;
  fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 300, clientY: 20 });
  fireEvent.pointerMove(window, { clientX: 700, clientY: 20 });
  fireEvent.pointerUp(window, { clientX: 700, clientY: 20 });
}

const cardsInGrid = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-board-grid] [data-task-key]")).map((card) =>
    card.getAttribute("data-task-key"),
  );

describe("reordering cards of an ungrouped board", () => {
  it("moves a card in manual order and tells the server its neighbours, status unchanged", async () => {
    ungrouped("manual");
    const boardMove = vi.fn(() => new Promise(() => {}));
    const slot = renderGrid(boardMove);
    await waitFor(() => slot.getByText("Task 3"));

    dragFirstPastLast(slot.container);

    await waitFor(() => expect(boardMove).toHaveBeenCalledTimes(1));
    expect(boardMove.mock.calls[0]).toEqual([
      expect.objectContaining({
        taskId: tasks[0]!.id,
        status: "todo",
        beforeTaskId: tasks[2]!.id,
        afterTaskId: null,
      }),
    ]);
    // Drawn in its new place before the server answers.
    expect(cardsInGrid(slot.container)).toEqual(["TSK-2", "TSK-3", "TSK-1"]);
  });

  it("leaves the order to the sort when one is chosen", async () => {
    ungrouped("priority");
    const boardMove = vi.fn(() => new Promise(() => {}));
    const slot = renderGrid(boardMove);
    await waitFor(() => slot.getByText("Task 3"));

    dragFirstPastLast(slot.container);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(boardMove).not.toHaveBeenCalled();
  });
});
