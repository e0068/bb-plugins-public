// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
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
const { setShowDescription, toggleFieldVisible } = await import("../common/row-field-preference.js");

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

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
const done = task(2, { id: `${PROJECT_ID}:done-child`, parentTaskId: EPIC, epicId: EPIC, status: "done" });
const deep = task(3, { id: `${PROJECT_ID}:deep-child`, parentTaskId: done.id, epicId: EPIC });
const tasks = [epic, done, deep];

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

const card = (container: HTMLElement, key: string) => {
  const element = container.querySelector(`[data-task-key="${key}"]`);
  if (element === null) throw new Error(`card ${key} not found`);
  return element as HTMLElement;
};

describe("the board and the task tree", () => {
  it("draws every task as a card in its status column, a child marked with its parent", async () => {
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-3"));
    const column = (status: string) => slot.container.querySelector(`[data-board-column="${status}"]`) as HTMLElement;
    expect(within(column("done")).getByText("TSK-2")).toBeDefined();
    expect(within(column("todo")).getByText("TSK-3")).toBeDefined();
    expect(within(card(slot.container, "TSK-3")).getByTitle("Parent: TSK-2 Task 2")).toBeDefined();
    expect(within(card(slot.container, "TSK-1")).queryByTitle(/^Parent/)).toBeNull();
  });

  it("counts done out of every task under a card, by default", async () => {
    const slot = renderBoard();
    await waitFor(() => card(slot.container, "TSK-1"));
    expect(within(card(slot.container, "TSK-1")).getByTitle("1 of 2 sub-tasks done").textContent).toBe("1/2");
  });

  it("shows the slug, the status and the list of sub-tasks once switched on, each row opening its task", async () => {
    for (const field of ["slug", "status", "subtaskList"] as const) toggleFieldVisible(`board:${PROJECT_ID}`, field);
    const slot = renderBoard();
    await waitFor(() => card(slot.container, "TSK-1"));
    const epicCard = within(card(slot.container, "TSK-1"));
    expect(epicCard.getByTitle("Slug: flow-epic").textContent).toBe("flow-epic");
    expect(epicCard.getByTitle("Status: In Progress")).toBeDefined();
    const rows = epicCard.getAllByRole("button", { name: /^Open TSK-/ });
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["Open TSK-2", "Open TSK-3"]);

    fireEvent.click(rows[1]!);
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "tasks", options: { subPath: "task/TSK-3" } });
  });
});

describe("sub-task stats and burndown on a card", () => {
  it("asks for no burndown while the field is off", async () => {
    const asked: unknown[] = [];
    const slot = renderBoard({
      taskBurndowns: (input: never) => {
        asked.push(input);
        return { burndowns: [] };
      },
    });
    await waitFor(() => card(slot.container, "TSK-1"));
    expect(asked).toEqual([]);
  });

  it("draws a Gantt lane per sub-task once switched on, and asks nothing while it is off", async () => {
    const asked: unknown[] = [];
    const now = Date.now();
    const segment = (status: string) => [{ status, fromMs: now - 3 * 86_400_000, toMs: now }];
    const ganttRows = (input: never) => {
      asked.push(input);
      return {
        rows: [done, deep].map((entry) => ({
          taskId: entry.id,
          key: entry.key,
          title: entry.title,
          projectId: PROJECT_ID,
          parentTaskId: entry.parentTaskId,
          status: entry.status,
          createdMs: now - 3 * 86_400_000,
          startDate: null,
          dueDate: null,
          segments: segment(entry.status === "done" ? "in_progress" : "todo"),
        })),
        projects: [],
      };
    };
    const off = renderBoard({ ganttRows });
    await waitFor(() => card(off.container, "TSK-1"));
    expect(asked).toEqual([]);
    cleanup();

    toggleFieldVisible(`board:${PROJECT_ID}`, "gantt");
    const slot = renderBoard({ ganttRows });
    await waitFor(() => expect(card(slot.container, "TSK-1").querySelectorAll("[data-gantt-row]")).toHaveLength(2));
    expect(card(slot.container, "TSK-2").querySelectorAll("[data-gantt-row]")).toHaveLength(1);
    expect(card(slot.container, "TSK-3").querySelector("[data-gantt-row]")).toBeNull();
  });

  it("opens a sub-task from the tooltip of its Gantt lane, not the card the Gantt sits on", async () => {
    const now = Date.now();
    const ganttRows = () => ({
      rows: [
        {
          taskId: deep.id,
          key: deep.key,
          title: deep.title,
          projectId: PROJECT_ID,
          parentTaskId: deep.parentTaskId,
          status: deep.status,
          createdMs: now - 3 * 86_400_000,
          startDate: null,
          dueDate: null,
          segments: [{ status: "todo", fromMs: now - 3 * 86_400_000, toMs: now }],
        },
      ],
      projects: [],
    });
    toggleFieldVisible(`board:${PROJECT_ID}`, "gantt");
    const slot = renderBoard({ ganttRows });
    await waitFor(() => expect(card(slot.container, "TSK-1").querySelector("[data-gantt-row]")).not.toBeNull());
    fireEvent.pointerMove(card(slot.container, "TSK-1").querySelector("[data-gantt-row]")!, { pointerType: "mouse" });
    const tip = await slot.findByTestId("gantt-row-tip");
    fireEvent.pointerDown(within(tip).getByRole("button"));
    fireEvent.click(within(tip).getByRole("button"));
    expect(slot.navigateCalls).toEqual([{ method: "toPluginPanel", path: "tasks", options: { subPath: `task/${deep.key}` } }]);
  });

});

describe("the key and the description on a card", () => {
  it("draws the key in the bottom row, below the title, and hides it once Key is switched off", async () => {
    const shown = renderBoard();
    await waitFor(() => card(shown.container, "TSK-1"));
    const epicCard = card(shown.container, "TSK-1");
    const key = within(epicCard).getByTitle("Key: TSK-1");
    const title = within(epicCard).getByText("Flow");
    expect(title.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();

    toggleFieldVisible(`board:${PROJECT_ID}`, "key");
    const hidden = renderBoard();
    await waitFor(() => card(hidden.container, "TSK-1"));
    expect(within(card(hidden.container, "TSK-1")).queryByTitle("Key: TSK-1")).toBeNull();
  });

  it("shows the first paragraph of the description, without headings and markup, once Show description is on", async () => {
    setShowDescription(`board:${PROJECT_ID}`, true);
    const described = { ...epic, description: "## Проблема\n\nКлюч **стоит** сверху.\n\n## Метод\n\nДругое." };
    const slot = renderBoard({ listTasks: () => ({ tasks: [described, done, deep] }) });
    await waitFor(() => card(slot.container, "TSK-1"));
    const epicCard = within(card(slot.container, "TSK-1"));
    expect(epicCard.getByText("Ключ стоит сверху.")).toBeDefined();
    expect(epicCard.queryByText(/Проблема|Метод|Другое/)).toBeNull();
  });
});

describe("card charts over the board's days", () => {
  it("draws the status bar and the burndown over the board's 7 days in days once switched on, only on a card with tasks under it", async () => {
    for (const field of ["subtaskStats", "burndown"] as const) toggleFieldVisible(`board:${PROJECT_ID}`, field);
    const asked: unknown[] = [];
    const now = Date.now();
    const slot = renderBoard({
      taskBurndowns: (input: never) => {
        asked.push(input);
        return { burndowns: [{ taskId: EPIC, open: [2, 2, 1], ends: [now - 2 * 86_400_000, now - 86_400_000, now], forecastMs: 2 * 86_400_000 }] };
      },
    });
    await waitFor(() => card(slot.container, "TSK-1"));
    const epicCard = within(card(slot.container, "TSK-1"));

    expect(epicCard.getByTitle("Done 1 · Todo 1").getAttribute("aria-label")).toBe("50% done");
    await waitFor(() => epicCard.getByText("1 open · ~2 d left"));
    expect(asked).toEqual([{ projectId: PROJECT_ID, period: 7, unit: "days" }]);
    expect(within(card(slot.container, "TSK-3")).queryByText(/open ·/)).toBeNull();
  });

  it("asks the burndown for the period and the unit the board's Display panel set, 0 for all time", async () => {
    toggleFieldVisible(`board:${PROJECT_ID}`, "burndown");
    const { setChartPreference, DEFAULT_CHART_PREFERENCE } = await import("./chart-preference.js");
    setChartPreference(`board:${PROJECT_ID}`, { ...DEFAULT_CHART_PREFERENCE, period: 0, unit: "hours" });
    const asked: unknown[] = [];
    const slot = renderBoard({
      taskBurndowns: (input: never) => {
        asked.push(input);
        return { burndowns: [] };
      },
    });
    await waitFor(() => card(slot.container, "TSK-1"));
    await waitFor(() => expect(asked).toEqual([{ projectId: PROJECT_ID, period: 0, unit: "hours" }]));
  });
});

describe("the dates of a card's charts", () => {
  const burndowns = () => {
    const now = Date.now();
    return { burndowns: [{ taskId: EPIC, open: [2, 2, 1], ends: [now - 2 * 86_400_000, now - 86_400_000, now], forecastMs: 2 * 86_400_000 }] };
  };

  it("writes the dates under the chart by default", async () => {
    toggleFieldVisible(`board:${PROJECT_ID}`, "burndown");
    const slot = renderBoard({ taskBurndowns: burndowns });
    await waitFor(() => within(card(slot.container, "TSK-1")).getByText(/open ·/));
    const epic = card(slot.container, "TSK-1");
    expect(epic.querySelector('[data-card-section="burndown"] [data-date-label]')).not.toBeNull();
    expect(epic.querySelector("[data-card-dates]")).toBeNull();
  });

  it("writes them once along the card's bottom, under everything, when the board asks — and with them off neither dates nor their lines", async () => {
    toggleFieldVisible(`board:${PROJECT_ID}`, "burndown");
    const { setChartPreference, DEFAULT_CHART_PREFERENCE } = await import("./chart-preference.js");
    setChartPreference(`board:${PROJECT_ID}`, { ...DEFAULT_CHART_PREFERENCE, dates: "card", dateDensity: "many" });
    const slot = renderBoard({ taskBurndowns: burndowns });
    await waitFor(() => within(card(slot.container, "TSK-1")).getByText(/open ·/));
    const epic = card(slot.container, "TSK-1");
    expect(epic.querySelector('[data-card-section="burndown"] [data-date-label]')).toBeNull();
    expect(epic.lastElementChild?.matches("[data-card-dates]")).toBe(true);
    expect(epic.querySelectorAll("[data-card-dates] [data-date-label]").length).toBeGreaterThan(0);
    expect(card(slot.container, "TSK-3").querySelector("[data-card-dates]")).toBeNull();

    setChartPreference(`board:${PROJECT_ID}`, { ...DEFAULT_CHART_PREFERENCE, dates: "off" });
    await waitFor(() => expect(epic.querySelector("[data-date-label]")).toBeNull());
    expect(epic.querySelector("[data-date-grid]")).toBeNull();
  });
});
