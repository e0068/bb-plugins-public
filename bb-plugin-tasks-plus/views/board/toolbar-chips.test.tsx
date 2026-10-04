// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
const { DEFAULT_BOARD_LAYOUT } = await import("./board-preference.js");

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

const task: Task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  projectId: PROJECT_ID,
  number: 1,
  key: "TSK-1",
  title: "Task 1",
  description: "",
  status: "todo",
  priority: "none",
  dueDate: null,
  startDate: null,
  parentTaskId: null,
  position: 1,
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
        listSavedViews: () => ({ savedViews: [boardView] }),
        listTasks: () => ({ tasks: [task] }),
        taskCardMeta: () => ({ cards: [] }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listComments: () => ({ comments: [] }),
        listAttachments: () => ({ attachments: [] }),
      },
    },
  );
}

/** A mouse press the way a pointer makes it — the event Radix menu triggers open and close on. */
const press = (element: Element) => fireEvent.pointerDown(element, { button: 0, ctrlKey: false, pointerType: "mouse" });

const statusChip = () => document.querySelector('[data-filter-chip="statuses"]');
const statusMenu = () => screen.queryByRole("menuitemcheckbox", { name: /Backlog/ });

async function pickStatusFromFilter(slot: ReturnType<typeof render>) {
  await waitFor(() => slot.getByText("TSK-1"));
  press(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /^Status/ }));
}

describe("a chip picked from Filter", () => {
  it("shows with its values menu open beneath it", async () => {
    const slot = render(`${PROJECT_ID}?view=board`);
    await pickStatusFromFilter(slot);
    await waitFor(() => expect(statusMenu()).not.toBeNull());
    expect(statusChip()).not.toBeNull();
  });

  it("stays when a click on it closes its menu, and the next click opens the menu again", async () => {
    const slot = render(`${PROJECT_ID}?view=board`);
    await pickStatusFromFilter(slot);
    await waitFor(() => expect(statusMenu()).not.toBeNull());

    press(statusChip()!.querySelector("button")!);
    await waitFor(() => expect(statusMenu()).toBeNull());
    expect(statusChip()).not.toBeNull();

    press(statusChip()!.querySelector("button")!);
    await waitFor(() => expect(statusMenu()).not.toBeNull());
  });

  it("stays empty after its menu closes, until its cross removes it", async () => {
    const slot = render(`${PROJECT_ID}?view=board`);
    await pickStatusFromFilter(slot);
    await waitFor(() => expect(statusMenu()).not.toBeNull());

    fireEvent.keyDown(statusMenu()!, { key: "Escape" });
    await waitFor(() => expect(statusMenu()).toBeNull());
    expect(statusChip()).not.toBeNull();

    fireEvent.click(slot.getByRole("button", { name: "Remove Status filter" }));
    await waitFor(() => expect(statusChip()).toBeNull());
  });

  it("leaves an open view unchanged while it picks nothing", async () => {
    const slot = render(`view/${VIEW_ID}`);
    await pickStatusFromFilter(slot);
    await waitFor(() => expect(statusMenu()).not.toBeNull());
    fireEvent.keyDown(statusMenu()!, { key: "Escape" });
    await waitFor(() => expect(statusMenu()).toBeNull());

    expect(statusChip()).not.toBeNull();
    expect(slot.queryByRole("button", { name: "Reset" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

/**
 * bb's DOM guard, as the app installs it: while any plugin's async work is in
 * flight, a node React made is not put into a parent React does not own — the
 * call is dropped without a word. <body> is such a parent, so a menu portaled
 * there never shows.
 */
function installBbDomGuard() {
  const ownedByReact = (node: Node) => Object.getOwnPropertyNames(node).some((key) => key.startsWith("__reactFiber$"));
  const dropped = (node: Node, parent: Node) => node.parentNode !== parent && ownedByReact(node) && !(node.parentNode === null && ownedByReact(parent));
  const append = Node.prototype.appendChild;
  const insert = Node.prototype.insertBefore;
  Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
    return dropped(node, this) ? node : append.call(this, node) as T;
  };
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, child: Node | null): T {
    return dropped(node, this) ? node : insert.call(this, node, child) as T;
  };
  return () => {
    Node.prototype.appendChild = append;
    Node.prototype.insertBefore = insert;
  };
}

describe("the toolbar's menus under bb's DOM guard", () => {
  let removeGuard = () => {};
  afterEach(() => removeGuard());

  it("still open: Filter, then the menu of the chip it picks", async () => {
    const slot = render(`${PROJECT_ID}?view=board`);
    await waitFor(() => slot.getByText("TSK-1"));
    removeGuard = installBbDomGuard();
    press(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Status/ }));
    await waitFor(() => expect(statusMenu()).not.toBeNull());
  });
});
