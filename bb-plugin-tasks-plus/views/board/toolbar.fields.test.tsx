// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { SavedView, Task } from "../../shared/contract.js";
import { QUERY_FIELDS } from "../../shared/enums.js";
import { ROW_FIELD_LABELS } from "../common/row-field-preference.js";

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
const { toggleFieldVisible } = await import("../common/row-field-preference.js");

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

const tasks = [
  task(1, { priority: "high", dueDate: "2026-10-05", title: "Zeta" }),
  task(2, { priority: "low", dueDate: "2026-11-20", title: "alpha" }),
];

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

describe("every field in Filter and Sort", () => {
  it("Filter offers an item for every field but the card's widgets", async () => {
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-2"));
    openMenu("Filter");
    const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent ?? "");
    for (const field of QUERY_FIELDS) {
      const label = field === "labels" ? "Label" : ROW_FIELD_LABELS[field];
      expect(items.some((text) => text.startsWith(label))).toBe(true);
    }
    expect(items.some((text) => text.startsWith("Sub-task Gantt"))).toBe(false);
  });

  it("a due date range picked from Filter narrows the board and shows as a chip", async () => {
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-2"));
    openMenu("Filter");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Due date/ }));
    fireEvent.change(await screen.findByLabelText("To"), { target: { value: "2026-10-31" } });
    await waitFor(() => expect(slot.queryByText("TSK-2")).toBeNull());
    expect(slot.getByText("TSK-1")).toBeDefined();
    expect(slot.container.querySelector('[data-filter-chip="dueDate"]')?.textContent).toContain("≤");
  });

  it("Sort offers every field on a board, and picking it again reverses the order", async () => {
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-2"));
    openMenu("Sort");
    const items = (await screen.findAllByRole("menuitemcheckbox")).map((item) => item.textContent ?? "");
    expect(items).toEqual(QUERY_FIELDS.map((field) => ROW_FIELD_LABELS[field]));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Title" }));
    const order = () => ["TSK-1", "TSK-2"].sort((a, b) => {
      const text = slot.container.textContent ?? "";
      return text.indexOf(a) - text.indexOf(b);
    });
    await waitFor(() => expect(order()).toEqual(["TSK-2", "TSK-1"]));
    openMenu("Sort");
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Title" }));
    await waitFor(() => expect(order()).toEqual(["TSK-1", "TSK-2"]));
  });

  it("a card shows the flow its task ran through once Flow is on in Display", async () => {
    toggleFieldVisible(boardKey(PROJECT_ID, null), "flow");
    const slot = renderBoard({ listTasks: () => ({ tasks: [task(1, { flow: { id: "f1", name: "Code" } }), task(2)] }) });
    await waitFor(() => slot.getByText("TSK-2"));
    const chips = slot.container.querySelectorAll('[title="Flow: Code"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]!.textContent).toBe("Code");
  });
});
