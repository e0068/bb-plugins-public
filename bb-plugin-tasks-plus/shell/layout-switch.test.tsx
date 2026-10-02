// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
// Stores imported after the app: a frontend module loaded before loadPluginApp breaks its SDK import.
const { DEFAULT_BOARD_LAYOUT, loadBoardLayout, scopeBoardKey, setBoardLayout } = await import("../views/board/board-preference.js");
const { loadListPreference, storeListPreference } = await import("../views/common/list-preference.js");
const { loadTableSettings, setTableSettings } = await import("../views/table/table-preference.js");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const P1 = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const VIEW = "01HZZZZZZZZZZZZZZZZZZZZZV1";
const BOARD_VIEW = "01HZZZZZZZZZZZZZZZZZZZZZV2";

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

const view = {
  id: VIEW,
  version: 2,
  name: "Mine",
  projectId: null,
  listScope: null,
  surface: "table",
  filters: { statuses: [], priorities: [], types: [], estimates: [], labelNames: [], assignees: [], parents: [] },
  sort: "manual",
  fields: { fields: [], showEmpty: false, showDescription: false },
  board: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

/** A board view grouped by priority, saved with no filters. */
const boardView = {
  ...view,
  id: BOARD_VIEW,
  name: "Board",
  surface: "board",
  board: { groupBy: "priority", columns: {}, hideEmpty: false },
};

function render(subPath: string) {
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
        listSavedViews: () => ({ savedViews: [view, boardView] }),
        listTasks: () => ({ tasks: [task(1), task(2, { status: "in_progress" }), task(3, { type: "epic" })], nextCursor: null }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listComments: () => ({ comments: [] }),
        listAttachments: () => ({ attachments: [] }),
      } as never,
    },
  );
}

const isTable = (slot: ReturnType<typeof render>) => slot.queryAllByRole("columnheader").length > 0;
const isBoard = (slot: ReturnType<typeof render>) => slot.container.querySelector("[data-board-column]") !== null;

const EPICS = { ...DEFAULT_BOARD_LAYOUT.filters, types: ["epic" as const] };

/** Flips the Display panel's Table/Board switch, opening the panel if it is closed. */
async function switchTo(slot: ReturnType<typeof render>, layout: "Table" | "Board") {
  if (slot.queryByRole("complementary", { name: "Display" }) === null) {
    fireEvent.click(within(slot.container.querySelector("header")!).getByRole("button", { name: "Display" }));
  }
  const panel = within(await slot.findByRole("complementary", { name: "Display" }));
  fireEvent.click(within(panel.getByRole("group", { name: "Layout" })).getByRole("button", { name: layout }));
  // A screen switches by navigating; the test host only records the call, so it is followed here.
  const last = slot.navigateCalls.at(-1) as { options?: { subPath?: string } } | undefined;
  if (last?.options?.subPath !== undefined) {
    slot.rerender(createElement(app.navPanels[0]!.component, { subPath: last.options.subPath }));
  }
  await waitFor(() => expect(layout === "Board" ? isBoard(slot) : isTable(slot)).toBe(true));
}

/** Only the epic is on screen, sorted by priority — what the owner left before switching. */
async function expectEpicsByPriority(slot: ReturnType<typeof render>) {
  await waitFor(() => expect(slot.queryByText("Task 3")).not.toBeNull());
  expect(slot.queryByText("Task 1")).toBeNull();
  expect(slot.queryByText("Task 2")).toBeNull();
  expect(within(slot.container.querySelector("header")!).getByRole("button", { name: "Clear sort" })).toBeTruthy();
}

const BY_PRIORITY = { column: "priority" as const, direction: "asc" as const };

describe("switching Table ↔ Board keeps filters and sort", () => {
  it("a screen's table filters and sort stay on its board", async () => {
    storeListPreference("all", { ...loadListPreference("all"), filters: EPICS });
    setTableSettings("all", { sort: BY_PRIORITY });
    const slot = render("all");
    await expectEpicsByPriority(slot);
    await switchTo(slot, "Board");
    await expectEpicsByPriority(slot);
  });

  it("a screen's board filters and sort stay on its table", async () => {
    setBoardLayout(scopeBoardKey("all", null), { ...DEFAULT_BOARD_LAYOUT, filters: EPICS, sort: BY_PRIORITY });
    const slot = render("all?view=board");
    await expectEpicsByPriority(slot);
    await switchTo(slot, "Table");
    await expectEpicsByPriority(slot);
  });

  it("a saved view keeps unsaved filters and sort through Table → Board → Table", async () => {
    const slot = render(`view/${VIEW}`);
    await waitFor(() => expect(isTable(slot)).toBe(true));
    storeListPreference("all", { ...loadListPreference("all"), filters: EPICS });
    setTableSettings("all", { sort: BY_PRIORITY });
    await expectEpicsByPriority(slot);
    await switchTo(slot, "Board");
    await expectEpicsByPriority(slot);
    await switchTo(slot, "Table");
    await expectEpicsByPriority(slot);
  });

  it("a saved view's grouping and column widths survive the switches, and the view reads as changed", async () => {
    const slot = render(`view/${BOARD_VIEW}`);
    await waitFor(() => expect(isBoard(slot)).toBe(true));
    const board = scopeBoardKey("all", BOARD_VIEW);
    setBoardLayout(board, { ...loadBoardLayout(board), filters: EPICS });
    await switchTo(slot, "Table");
    setTableSettings("all", { widths: { title: 333 } });
    await switchTo(slot, "Board");
    expect(loadBoardLayout(board).grouping.groupBy).toBe("priority");
    await switchTo(slot, "Table");
    expect(loadTableSettings("all").widths).toEqual({ title: 333 });
    await waitFor(() => expect(slot.queryByText("Task 3")).not.toBeNull());
    expect(slot.queryByText("Task 1")).toBeNull();
    expect(within(slot.container.querySelector("header")!).getByRole("button", { name: "Reset" })).toBeTruthy();
  });
});
