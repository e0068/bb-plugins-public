// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { SavedView, Task } from "../shared/contract.js";

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
const { storeListPreference } = await import("../views/common/list-preference.js");
const { EMPTY_FILTERS } = await import("../views/common/filter-state.js");
const { resetFieldDisplay, toggleFieldVisible } = await import("../views/common/row-field-preference.js");

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const VIEW_ID = "01HZZZZZZZZZZZZZZZZZZZZZV1";
const SCOPE = `project:${PROJECT_ID}` as const;

beforeEach(() => {
  window.localStorage.clear();
  resetFieldDisplay(SCOPE);
  resetFieldDisplay(`board:${PROJECT_ID}`);
  storeListPreference(SCOPE, { filters: EMPTY_FILTERS, sort: "manual" });
});
afterEach(cleanup);

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

const tasks = [task(1, { priority: "high" }), task(2, { priority: "low" })];

const listView: SavedView = {
  id: VIEW_ID,
  version: 2,
  name: "Hot list",
  projectId: PROJECT_ID,
  listScope: null,
  surface: "table",
  filters: { ...EMPTY_FILTERS, priorities: ["high"] },
  sort: "manual",
  fields: { fields: [], showEmpty: false, showDescription: false },
  board: null,
  table: null,
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
        listSavedViews: () => ({ savedViews: [listView] }),
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

const header = (slot: ReturnType<typeof render>) => within(slot.container.querySelector("header")!);
const headerButtons = (slot: ReturnType<typeof render>) =>
  ["Sort", "Filter", "Display"].map((name) => header(slot).queryByRole("button", { name }) !== null);
const openMenu = (slot: ReturnType<typeof render>, name: string) =>
  fireEvent.keyDown(header(slot).getByRole("button", { name }), { key: "Enter" });

describe("one header for the list and the board", () => {
  it("carries Sort, Filter and Display on a list and on a board, and no List/Board switch", async () => {
    const list = render(`${PROJECT_ID}?view=list`);
    await list.findByText("TSK-2");
    expect(headerButtons(list)).toEqual([true, true, true]);
    expect(header(list).queryByRole("button", { name: "Board" })).toBeNull();
    cleanup();

    const board = render(`${PROJECT_ID}?view=board`);
    await waitFor(() => board.getByTitle("Key: TSK-2"));
    expect(headerButtons(board)).toEqual([true, true, true]);
    expect(header(board).queryByRole("button", { name: "Group" })).toBeNull();
  });

  it("filters the list from Filter, showing the filter as a chip", async () => {
    const slot = render(`${PROJECT_ID}?view=list`);
    await slot.findByText("TSK-2");
    openMenu(slot, "Filter");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Priority/ }));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: /High/ }));
    await waitFor(() => expect(slot.queryByText("TSK-2")).toBeNull());
    expect(slot.container.querySelector('[data-filter-chip="priorities"]')?.textContent).toContain("High");
  });

  it("offers Save view on a project board once only its card fields change, as on a list", async () => {
    const slot = render(`${PROJECT_ID}?view=board`);
    await waitFor(() => slot.getByTitle("Key: TSK-2"));
    expect(header(slot).queryByRole("button", { name: "Save view" })).toBeNull();
    act(() => toggleFieldVisible(`board:${PROJECT_ID}`, "slug"));
    expect(await header(slot).findByRole("button", { name: "Save view" })).toBeDefined();
  });

  it("offers Reset and Save once an open list view changes, and Reset puts the view back", async () => {
    const slot = render(`view/${VIEW_ID}`);
    await slot.findByText("TSK-1");
    expect(slot.queryByText("TSK-2")).toBeNull();
    expect(header(slot).queryByRole("button", { name: "Reset" })).toBeNull();
    act(() => storeListPreference(SCOPE, { filters: EMPTY_FILTERS, sort: "manual" }));
    await slot.findByText("TSK-2");
    fireEvent.click(await header(slot).findByRole("button", { name: "Reset" }));
    await waitFor(() => expect(slot.queryByText("TSK-2")).toBeNull());
    expect(header(slot).queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("the Display panel", () => {
  const openPanel = async (slot: ReturnType<typeof render>) => {
    fireEvent.click(header(slot).getByRole("button", { name: "Display" }));
    return within(await slot.findByRole("complementary", { name: "Display" }));
  };

  it("opens beside the tasks from Display and closes from it again", async () => {
    const slot = render(`${PROJECT_ID}?view=list`);
    await slot.findByText("TSK-2");
    await openPanel(slot);
    expect(header(slot).getByRole("button", { name: "Display" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(header(slot).getByRole("button", { name: "Display" }));
    await waitFor(() => expect(slot.queryByRole("complementary", { name: "Display" })).toBeNull());
  });

  it("moves the title in the field list but never hides it", async () => {
    const board = render(`${PROJECT_ID}?view=board`);
    await waitFor(() => board.getByTitle("Key: TSK-2"));
    const panel = await openPanel(board);
    expect(panel.getByRole("button", { name: "Reorder Title" })).toBeDefined();
    expect(panel.getByText("always shown")).toBeDefined();
    expect(panel.queryByRole("button", { name: "Title" })).toBeNull();
  });

  it("is not there on a task", async () => {
    const slot = render("task/TSK-1");
    await waitFor(() => slot.getByText("TSK-1"));
    expect(slot.queryByRole("button", { name: "Display" })).toBeNull();
    expect(slot.queryByRole("complementary", { name: "Display" })).toBeNull();
  });
});
