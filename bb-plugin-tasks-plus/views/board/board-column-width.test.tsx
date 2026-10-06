// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
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
const { boardKey, setBoardLayout, DEFAULT_BOARD_LAYOUT } = await import("./board-preference.js");

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

function renderBoard(bounds?: { min: number; initial: number; max: number }) {
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
        ...(bounds ? { loadColumnWidthBounds: () => bounds } : {}),
        listTaskThreads: () => ({ taskThreads: [] }),
      },
    },
  );
}

const column = () => document.querySelector<HTMLElement>('[data-board-column="backlog"]')!.parentElement!;
const card = (key: string) => document.querySelector(`[data-task-key="${key}"]`) as HTMLElement;

const WIDE = { min: 150, initial: 320, max: 900 };

const withBacklogWidth = (width: number) =>
  setBoardLayout(BOARD, {
    ...DEFAULT_BOARD_LAYOUT,
    grouping: { groupBy: "status", columns: { status: { order: [], hidden: [], widths: { backlog: width } } }, hideEmpty: false },
  });

describe("board column widths under the owner's bounds from the settings", () => {
  it("draws a column nobody has dragged at the default width the settings name", async () => {
    renderBoard(WIDE);
    await waitFor(() => expect(column().style.width).toBe("320px"));
  });

  it("holds a width kept before the bounds narrowed inside the maximum when the board reads it", async () => {
    withBacklogWidth(800);
    renderBoard();
    await waitFor(() => card("TSK-1").textContent);
    expect(column().style.width).toBe("480px");
  });

  it("lets the same kept width stand once the settings allow it", async () => {
    withBacklogWidth(800);
    renderBoard(WIDE);
    await waitFor(() => expect(column().style.width).toBe("800px"));
  });
});
