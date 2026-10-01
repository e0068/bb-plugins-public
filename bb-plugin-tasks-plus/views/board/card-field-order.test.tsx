// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
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
const { toggleFieldVisible, loadFieldDisplay, moveField, resetFieldDisplay } = await import("../common/row-field-preference.js");
const { boardKey } = await import("./board-preference.js");

afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const KEY = boardKey(PROJECT_ID, null);

// The field store keeps its document in memory across tests: start each one on the board default.
beforeEach(() => {
  window.localStorage.clear();
  resetFieldDisplay(KEY);
});

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
const epic = task(1, { id: EPIC, title: "Flow", type: "epic", status: "in_progress", description: "What the epic is for." });
const CHILD = `${PROJECT_ID}:ship-cards`;
const fromWorktree = {
  filePath: "/wt/docs/tasks/todo/ship-cards.md",
  origin: { kind: "worktree", environmentId: "env_1", name: null, branchName: "bb/ship" },
} as unknown as Task["source"];
const tasks = [
  epic,
  task(2, { parentTaskId: EPIC, status: "done" }),
  task(3, { id: CHILD, parentTaskId: EPIC, source: fromWorktree }),
];

/** The child card's chips: two files attached, an agent at work on it. */
const childMeta = {
  taskId: CHILD,
  attachmentCount: 2,
  taskThreads: [
    {
      id: "thread-record-1",
      taskId: CHILD,
      threadId: "thr_ship",
      presetName: "Implementer",
      title: "Ship the cards",
      liveStatus: "working",
      archivedAt: null,
      attachedAt: "2026-07-15T00:00:00.000Z",
    },
  ],
};
let metaCalls = 0;

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
        taskCardMeta: () => {
          metaCalls += 1;
          return { cards: [childMeta] };
        },
        listTaskThreads: () => ({ taskThreads: [] }),
      },
    },
  );
}

/** The epic card's sections top to bottom: a block by its field, a chip row as "chips". */
const sections = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-task-key="TSK-1"] [data-card-section]'), (node) =>
    node.getAttribute("data-card-section"),
  );

/** Drag `field` in the board's Display menu to where `before` stands now. */
const dragOnto = (field: string, before: string) => {
  const fields = loadFieldDisplay(KEY).fields.map((entry) => entry.field);
  moveField(KEY, fields.indexOf(field as never), fields.indexOf(before as never));
};

const renderEpic = async () => {
  const slot = renderBoard();
  await waitFor(() => slot.getByTitle("Key: TSK-1"));
  return slot;
};

describe("the order of a board card", () => {
  it("draws Sub-task list above Sub-task stats when the menu puts it there", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    toggleFieldVisible(KEY, "subtaskStats");
    dragOnto("subtaskList", "description");
    const slot = await renderEpic();
    expect(sections(slot.container)).toEqual(["title", "subtaskList", "chips", "subtaskStats"]);
  });

  it("draws Sub-task stats above Sub-task list when the menu puts it there", async () => {
    toggleFieldVisible(KEY, "subtaskList");
    toggleFieldVisible(KEY, "subtaskStats");
    dragOnto("subtaskStats", "subtaskList");
    const slot = await renderEpic();
    expect(sections(slot.container)).toEqual(["title", "chips", "subtaskStats", "subtaskList"]);
  });

  it("draws the chips standing between two blocks in the menu as their own row between them", async () => {
    toggleFieldVisible(KEY, "description");
    toggleFieldVisible(KEY, "subtaskStats");
    dragOnto("subtaskStats", "priority");
    const slot = await renderEpic();
    expect(sections(slot.container)).toEqual(["title", "description", "chips", "subtaskStats", "chips"]);
  });

  it("follows a reorder made while the board is open", async () => {
    toggleFieldVisible(KEY, "description");
    const slot = await renderEpic();
    expect(sections(slot.container)).toEqual(["title", "description", "chips"]);
    act(() => dragOnto("key", "description"));
    await waitFor(() => expect(sections(slot.container)).toEqual(["title", "chips", "description", "chips"]));
  });

  it("draws a board with the default fields as one chip row under the title", async () => {
    const slot = await renderEpic();
    expect(sections(slot.container)).toEqual(["title", "chips"]);
  });
});

/** The child card, once its chips have arrived. */
const renderChild = async () => {
  metaCalls = 0;
  const slot = renderBoard();
  await waitFor(() => expect(metaCalls).toBeGreaterThan(0));
  await waitFor(() => slot.getByText("Task 3"));
  return slot.container.querySelector<HTMLElement>('[data-task-key="TSK-3"]')!;
};

describe("the fields of a board card", () => {
  it("shows the parent, the working agent, the paperclip and the worktree mark by default", async () => {
    const card = await renderChild();
    await waitFor(() => expect(card.textContent).toContain("Implementer"));
    expect(card.textContent).toContain("TSK-1");
    expect(card.querySelector('[aria-label="2 attachments"]')).not.toBeNull();
    expect(card.querySelector("[data-worktree-mark]")).not.toBeNull();
  });

  it("draws nothing but the title when every field is off", async () => {
    for (const entry of loadFieldDisplay(KEY).fields) if (entry.visible) toggleFieldVisible(KEY, entry.field);
    const card = await renderChild();
    expect(card.textContent).toBe("Task 3");
    expect(card.querySelectorAll("svg")).toHaveLength(0);
  });

  it("draws the slug where the View lists it — above the title when it stands above it", async () => {
    toggleFieldVisible(KEY, "slug");
    dragOnto("slug", "parent");
    const card = await renderChild();
    const [first] = Array.from(card.querySelectorAll("[data-card-section]"));
    expect(first?.getAttribute("data-card-section")).toBe("chips");
    expect(first?.textContent).toContain("ship-cards");
  });

  it("draws the slug below the title when it stands below it", async () => {
    toggleFieldVisible(KEY, "slug");
    const card = await renderChild();
    const names = Array.from(card.querySelectorAll("[data-card-section]"), (node) => node.getAttribute("data-card-section"));
    const title = names.indexOf("title");
    const slugRow = Array.from(card.querySelectorAll("[data-card-section]")).findIndex((node) => node.textContent?.includes("ship-cards"));
    expect(slugRow).toBeGreaterThan(title);
  });
});
