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
const { toggleFieldVisible } = await import("../common/row-field-preference.js");
const { boardKey, loadBoardLayout } = await import("./board-preference.js");
const { loadChartPreference } = await import("./chart-preference.js");
const { DESCRIPTION_SIZE_CLASS, TITLE_SIZE_CLASS } = await import("./card-text-preference.js");

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

const EPIC = `${PROJECT_ID}:flow-epic`;
const tasks = [
  task(1, "flow-epic", { title: "Flow", type: "epic", description: "Where the flow work lives." }),
  task(2, "board-child", { title: "Board", parentTaskId: EPIC, epicId: EPIC }),
  task(3, "deep-child", { title: "Deep", parentTaskId: `${PROJECT_ID}:board-child`, epicId: EPIC }),
  task(4, "loose", { title: "Loose" }),
  task(null, "keyless-work-with-a-long-slug", { title: "Keyless", parentTaskId: EPIC, epicId: EPIC }),
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

const cardKeys = () => Array.from(document.querySelectorAll("[data-task-key]"), (card) => card.getAttribute("data-task-key")).sort();
const card = (key: string) => document.querySelector(`[data-task-key="${key}"]`) as HTMLElement;
const openMenu = (name: string) => fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
const openDisplay = async (slot: ReturnType<typeof renderBoard>) => {
  fireEvent.click(slot.getByRole("button", { name: "Display" }));
  return within(await screen.findByRole("complementary", { name: "Display" }));
};

describe("the Parent filter", () => {
  it("suggests the tasks with tasks under them, narrows them by what is typed, and filters the board by the ticked one, staying open", async () => {
    const slot = renderBoard();
    await waitFor(() => slot.getByText("TSK-4"));
    openMenu("Filter");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Parent/ }));
    const input = await screen.findByPlaceholderText("Parent…");
    const suggested = () => screen.queryAllByRole("option").map((option) => option.textContent);
    expect(suggested()).toEqual(["TSK-1Flow", "TSK-2Board"]);

    fireEvent.change(input, { target: { value: "board-ch" } });
    await waitFor(() => expect(suggested()).toEqual(["TSK-2Board"]));
    fireEvent.change(input, { target: { value: "flow" } });
    await waitFor(() => expect(suggested()).toEqual(["TSK-1Flow"]));

    fireEvent.click(screen.getByRole("option", { name: /TSK-1/ }));
    await waitFor(() => expect(cardKeys()).toEqual(["TSK-2", "TSK-3", "keyless-work-with-a-long-slug"].sort()));
    expect(loadBoardLayout(BOARD).filters.parents).toEqual([EPIC]);
    expect(screen.getByPlaceholderText("Parent…")).toBeDefined();
    expect(slot.container.querySelector('[data-filter-chip="parents"]')?.textContent).toContain("TSK-1");
  });
});

describe("a card's text", () => {
  it("takes the title and description sizes the Display panel picks, the description dimmer than the title", async () => {
    toggleFieldVisible(BOARD, "description");
    const slot = renderBoard();
    await waitFor(() => card("TSK-1").textContent);
    const title = () => within(card("TSK-1")).getByText("Flow");
    const description = () => within(card("TSK-1")).getByText("Where the flow work lives.");
    expect(title().className).toContain(TITLE_SIZE_CLASS.m);
    expect(description().className).toContain(DESCRIPTION_SIZE_CLASS.xs);
    expect(description().className).toContain("text-subtle-foreground");

    const panel = await openDisplay(slot);
    fireEvent.click(within(panel.getByRole("group", { name: "Title size" })).getByRole("button", { name: "L" }));
    fireEvent.click(within(panel.getByRole("group", { name: "Description size" })).getByRole("button", { name: "M" }));
    await waitFor(() => expect(title().className).toContain(TITLE_SIZE_CLASS.l));
    expect(description().className).toContain(DESCRIPTION_SIZE_CLASS.m);
  });

  it("keeps the title and description line spacing snug whatever size they take", async () => {
    toggleFieldVisible(BOARD, "description");
    const slot = renderBoard();
    await waitFor(() => card("TSK-1").textContent);
    const spacing = () => [
      within(card("TSK-1")).getByText("Flow").className.split(" "),
      within(card("TSK-1")).getByText("Where the flow work lives.").className.split(" "),
    ];
    for (const classes of spacing()) expect(classes).toContain("leading-snug");
    const panel = await openDisplay(slot);
    fireEvent.click(within(panel.getByRole("group", { name: "Title size" })).getByRole("button", { name: "L" }));
    fireEvent.click(within(panel.getByRole("group", { name: "Description size" })).getByRole("button", { name: "M" }));
    await waitFor(() => expect(within(card("TSK-1")).getByText("Flow").className).toContain(TITLE_SIZE_CLASS.l));
    for (const classes of spacing()) expect(classes).toContain("leading-snug");
  });

  // jsdom lays nothing out: what is checked is that the slug is a chip of its
  // row that grows into the room left, from 80 to 160 px, and truncates.
  it("keeps a slug among the row's chips, growing into the room left, 80 to 160 px wide", async () => {
    toggleFieldVisible(BOARD, "slug");
    renderBoard();
    await waitFor(() => card("keyless-work-with-a-long-slug").textContent);
    const slug = within(card("keyless-work-with-a-long-slug")).getByTitle("Slug: keyless-work-with-a-long-slug");
    expect(slug.parentElement?.getAttribute("data-card-section")).toBe("chips");
    expect(slug.className.split(" ")).toEqual(expect.arrayContaining(["flex-1", "min-w-20", "max-w-40", "truncate"]));
  });
});

describe("the days the card charts cover", () => {
  it("takes a typed day count, 0 for all time, and leaves the stored one alone while the field holds no day count", async () => {
    const slot = renderBoard();
    await waitFor(() => card("TSK-1").textContent);
    const panel = await openDisplay(slot);
    const days = panel.getByRole("spinbutton", { name: "Days the card charts cover" });
    expect((days as HTMLInputElement).value).toBe("7");

    fireEvent.change(days, { target: { value: "45" } });
    expect(loadChartPreference(BOARD).period).toBe(45);
    fireEvent.change(days, { target: { value: "-3" } });
    fireEvent.change(days, { target: { value: "" } });
    expect(loadChartPreference(BOARD).period).toBe(45);
    fireEvent.change(days, { target: { value: "0" } });
    expect(loadChartPreference(BOARD).period).toBe(0);
  });
});
