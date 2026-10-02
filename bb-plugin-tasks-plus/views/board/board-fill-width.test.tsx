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
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
window.PointerEvent ??= class extends MouseEvent {} as unknown as typeof PointerEvent;

const app = await loadPluginApp(() => import("../../app"));
// After the app: a module that reaches the SDK must not load before loadPluginApp.
const { boardKey, loadBoardLayout, setBoardLayout, DEFAULT_BOARD_LAYOUT } = await import("./board-preference.js");
const { fillsWidth } = await import("./grouping.js");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const BOARD = boardKey(PROJECT_ID, null);

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

function task(number: number | null, slug: string, patch: Partial<Task> = {}): Task {
  return {
    id: `${PROJECT_ID}:${slug}`,
    projectId: PROJECT_ID,
    number,
    key: number === null ? slug : `TSK-${number}`,
    title: `Task ${slug}`,
    description: "",
    status: "todo",
    priority: "none",
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    position: number ?? 0,
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

const tasks = [
  task(1, "flow-epic", { title: "Flow" }),
  task(2, "loose", { title: "Loose" }),
];

function renderBoard() {
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
      },
    },
  );
}

const card = (key: string) => document.querySelector(`[data-task-key="${key}"]`) as HTMLElement;
const openDisplay = async (slot: ReturnType<typeof renderBoard>) => {
  fireEvent.click(slot.getByRole("button", { name: "Display" }));
  return within(await screen.findByRole("complementary", { name: "Display" }));
};

describe("board columns that fill the board's width", () => {
  it("keep their own width until Fill width is on, then grow from it to the board's edges", async () => {
    const slot = renderBoard();
    await waitFor(() => card("TSK-1").textContent);
    const column = () => document.querySelector<HTMLElement>('[data-board-column="backlog"]')!.parentElement!;
    expect(column().style.width).toBe("230px");
    expect(column().style.flexGrow).toBe("");

    const panel = await openDisplay(slot);
    fireEvent.click(within(panel.getByRole("group", { name: "Board columns" })).getByText("Fill width"));
    expect(loadBoardLayout(BOARD).grouping.fillWidth).toBe(true);
    await waitFor(() => expect(column().style.flexGrow).toBe("1"));
    expect(column().style.flexBasis).toBe("230px");
    expect(column().style.width).toBe("");

    fireEvent.click(within(panel.getByRole("group", { name: "Board columns" })).getByText("Fill width"));
    expect("fillWidth" in loadBoardLayout(BOARD).grouping).toBe(false);
  });

  it("keeps Fill width across a reload, and reads a grouping saved before it — or with any other value — as off", async () => {
    setBoardLayout(BOARD, { ...DEFAULT_BOARD_LAYOUT, grouping: { ...DEFAULT_BOARD_LAYOUT.grouping, fillWidth: true } });
    expect(fillsWidth(loadBoardLayout(BOARD).grouping)).toBe(true);
    setBoardLayout(BOARD, { ...DEFAULT_BOARD_LAYOUT, grouping: { groupBy: "status", columns: {}, hideEmpty: false } });
    expect(fillsWidth(loadBoardLayout(BOARD).grouping)).toBe(false);
    setBoardLayout(BOARD, { ...DEFAULT_BOARD_LAYOUT, grouping: { groupBy: "status", columns: {}, hideEmpty: false, fillWidth: false as never } });
    expect("fillWidth" in loadBoardLayout(BOARD).grouping).toBe(false);
    renderBoard();
    await waitFor(() => card("TSK-1").textContent);
    expect(document.querySelector<HTMLElement>('[data-board-column="backlog"]')!.parentElement!.style.width).toBe("230px");
  });

  it("with Fill width on, lets the columns shrink below their own widths as well as grow", async () => {
    setBoardLayout(BOARD, { ...DEFAULT_BOARD_LAYOUT, grouping: { ...DEFAULT_BOARD_LAYOUT.grouping, fillWidth: true } });
    renderBoard();
    await waitFor(() => card("TSK-1").textContent);
    const column = document.querySelector<HTMLElement>('[data-board-column="backlog"]')!.parentElement!;
    expect(column.style.flexShrink).toBe("1");
    expect(column.style.minWidth).toBe("0px");
    expect(column.className.split(" ")).not.toContain("shrink-0");
  });
});
