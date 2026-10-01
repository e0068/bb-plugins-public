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
const { toggleFieldVisible, loadFieldDisplay, setSubtaskScope, defaultConfig, subtaskScopeOf } = await import(
  "../common/row-field-preference.js"
);
const { applyBoardState, boardKey, captureBoardState, DEFAULT_BOARD_LAYOUT, loadBoardLayout, setBoardLayout } =
  await import("./board-preference.js");
const { gridColumnsOf } = await import("./grouping.js");

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

const EPIC = `${PROJECT_ID}:flow-epic`;
const epic = task(1, { id: EPIC, title: "Flow", type: "epic", status: "in_progress" });
const done = task(2, { id: `${PROJECT_ID}:done-child`, parentTaskId: EPIC, status: "done" });
const deep = task(3, { id: `${PROJECT_ID}:deep-child`, parentTaskId: done.id });
const open = task(4, { id: `${PROJECT_ID}:open-child`, parentTaskId: EPIC });
const tasks = [epic, done, deep, open];

function renderBoard(listed: readonly Task[] = tasks) {
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
        listTasks: () => ({ tasks: listed }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
      },
    },
  );
}

const ungrouped = (gridColumns?: unknown) =>
  setBoardLayout(KEY, {
    ...DEFAULT_BOARD_LAYOUT,
    grouping: { groupBy: "none", columns: {}, hideEmpty: false, ...(gridColumns === undefined ? {} : { gridColumns }) } as never,
  });

const grid = (container: HTMLElement) => container.querySelector("[data-board-grid]") as HTMLElement;

const subtaskRows = (container: HTMLElement) =>
  within(container.querySelector('[data-task-key="TSK-1"]') as HTMLElement)
    .queryAllByRole("button", { name: /^Open TSK-/ })
    .map((row) => row.getAttribute("aria-label"));

describe("the number of columns of an ungrouped board", () => {
  it("lays the cards out in exactly the chosen number of columns", async () => {
    ungrouped(3);
    const slot = renderBoard();
    await waitFor(() => slot.getByTitle("Key: TSK-1"));
    expect(grid(slot.container).style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
  });

  it("fits as many columns as there is room for on auto", async () => {
    ungrouped("auto");
    const slot = renderBoard();
    await waitFor(() => slot.getByTitle("Key: TSK-1"));
    expect(grid(slot.container).style.gridTemplateColumns).toBe("");
  });

  it("is chosen in the Display panel while nothing groups the board", async () => {
    ungrouped();
    const slot = renderBoard();
    await waitFor(() => slot.getByTitle("Key: TSK-1"));
    fireEvent.click(slot.getByRole("button", { name: "Display" }));
    fireEvent.click(await screen.findByRole("button", { name: "2 columns" }));
    await waitFor(() => expect(gridColumnsOf(loadBoardLayout(KEY).grouping)).toBe(2));
    expect(grid(slot.container).style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
  });

  it("is not offered while the board is grouped", async () => {
    const slot = renderBoard();
    await waitFor(() => slot.getByTitle("Key: TSK-1"));
    fireEvent.click(slot.getByRole("button", { name: "Display" }));
    await screen.findByRole("group", { name: "Group by" });
    expect(screen.queryByRole("button", { name: "2 columns" })).toBeNull();
  });

  it("keeps a stored count and falls back to auto on anything else", () => {
    ungrouped(4);
    expect(gridColumnsOf(loadBoardLayout(KEY).grouping)).toBe(4);
    ungrouped(9);
    expect(gridColumnsOf(loadBoardLayout(KEY).grouping)).toBe("auto");
  });

  it("leaves a board on auto the same as one saved before the choice existed", () => {
    ungrouped("auto");
    expect(loadBoardLayout(KEY).grouping).toEqual({ groupBy: "none", columns: {}, hideEmpty: false });
  });
});

describe("which sub-tasks a card lists", () => {
  it("lists every sub-task by default", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const slot = renderBoard();
    await waitFor(() => slot.getByTitle("Key: TSK-1"));
    expect(subtaskRows(slot.container)).toEqual(["Open TSK-2", "Open TSK-3", "Open TSK-4"]);
  });

  it("lists open sub-tasks at any depth, keeping the closed parent of an open one", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    setSubtaskScope(KEY, "open");
    const slot = renderBoard();
    await waitFor(() => slot.getByTitle("Key: TSK-1"));
    expect(subtaskRows(slot.container)).toEqual(["Open TSK-2", "Open TSK-3", "Open TSK-4"]);
    cleanup();

    const closedDeep = renderBoard([epic, done, { ...deep, status: "done" }, open]);
    await waitFor(() => closedDeep.getByTitle("Key: TSK-1"));
    expect(subtaskRows(closedDeep.container)).toEqual(["Open TSK-4"]);
  });

  it("lists only open children, one level down, in the open-children scope", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    setSubtaskScope(KEY, "open-children");
    const slot = renderBoard();
    await waitFor(() => slot.getByTitle("Key: TSK-1"));
    expect(subtaskRows(slot.container)).toEqual(["Open TSK-4"]);
  });

  it("is chosen in the board's Display panel", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const slot = renderBoard();
    await waitFor(() => slot.getByTitle("Key: TSK-1"));
    fireEvent.click(slot.getByRole("button", { name: "Display" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open, first level" }));
    await waitFor(() => expect(subtaskRows(slot.container)).toEqual(["Open TSK-4"]));
    expect(subtaskScopeOf(loadFieldDisplay(KEY))).toBe("open-children");
  });

  it("leaves a board on all the same as one saved before the choice existed", () => {
    setSubtaskScope(KEY, "open");
    setSubtaskScope(KEY, "all");
    expect(loadFieldDisplay(KEY)).toEqual(defaultConfig("board"));
  });
});

describe("a board view carrying both choices", () => {
  it("brings the column count and the sub-task scope to the board it is applied to", () => {
    ungrouped(3);
    setSubtaskScope(KEY, "open");
    const other = boardKey(PROJECT_ID, "view-1");
    applyBoardState(other, captureBoardState(KEY));
    expect(gridColumnsOf(loadBoardLayout(other).grouping)).toBe(3);
    expect(subtaskScopeOf(loadFieldDisplay(other))).toBe("open");
  });
});

describe("a sub-task row", () => {
  it("shows the sub-task's title and neither its key nor its slug", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    const slot = renderBoard();
    await waitFor(() => slot.getByTitle("Key: TSK-1"));
    const row = within(slot.container.querySelector('[data-task-key="TSK-1"]') as HTMLElement).getByRole("button", {
      name: "Open TSK-4",
    });
    expect(row.textContent).toBe("Task 4");
  });
});
