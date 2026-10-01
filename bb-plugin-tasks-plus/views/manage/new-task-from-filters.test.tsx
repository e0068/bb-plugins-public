// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { Task } from "../../shared/contract.js";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
window.matchMedia ??= (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

// loadPluginApp installs the fake SDK runtime; nothing SDK-touching may be
// imported before it runs.
const app = await loadPluginApp(() => import("../../app"));
const { LIST_PREFERENCE_STORAGE_KEY } = await import(
  "../common/list-preference.js"
);

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const PROJECT_A = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const PROJECT_B = "01HZZZZZZZZZZZZZZZZZZZZZP2";
const UI_A = "01HZZZZZZZZZZZZZZZZZZZZLA1";
const UI_B = "01HZZZZZZZZZZZZZZZZZZZZLB1";
const VIEW_ID = "01J0000000000000000000000A";
const ME = "Vakhnin Sergei";

function project(id: string, name: string, prefix: string) {
  return {
    id,
    name,
    prefix,
    nextTaskNumber: 5,
    color: "blue",
    folderId: null,
    linkedBbProjectId: null,
    createdAt: "2026-07-15T00:00:00.000Z",
  };
}

const labels = [
  { id: UI_A, projectId: PROJECT_A, name: "ui", color: "#888" },
  { id: UI_B, projectId: PROJECT_B, name: "ui", color: "#888" },
];

function task(overrides: Partial<Task>): Task {
  return {
    id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
    projectId: PROJECT_A,
    number: 1,
    key: "ALP-1",
    title: "Existing",
    description: "",
    status: "in_progress",
    priority: "high",
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    position: 1,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [UI_A],
    type: "feature",
    estimate: "m",
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    source: null,
    assignee: ME,
    epic: "Flow",
    ...overrides,
  } as Task;
}

type StoredFilters = Record<
  "statuses" | "priorities" | "types" | "estimates" | "labelNames" | "assignees" | "parents",
  string[]
>;

const NO_FILTERS: StoredFilters = {
  statuses: [],
  priorities: [],
  types: [],
  estimates: [],
  labelNames: [],
  assignees: [],
  parents: [],
};

const MY_FILTERS: StoredFilters = {
  ...NO_FILTERS,
  statuses: ["in_progress", "in_review"],
  priorities: ["high"],
  types: ["feature"],
  estimates: ["m"],
  labelNames: ["ui"],
  assignees: [ME],
  parents: ["Flow"],
};

function storeFilters(scope: string, filters: StoredFilters) {
  window.localStorage.setItem(
    LIST_PREFERENCE_STORAGE_KEY,
    JSON.stringify({ version: 1, scopes: { [scope]: { filters, sort: "manual" } } }),
  );
}

function rpc(createCalls: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return {
    listProjects: () => ({
      projects: [project(PROJECT_A, "Alpha", "ALP"), project(PROJECT_B, "Beta", "BET")],
    }),
    listFolders: () => ({ folders: [] }),
    listPresets: () => ({ presets: [] }),
    sidebarSummary: () => ({ projects: [] }),
    listSavedViews: () => ({ savedViews: [] }),
    listTasks: () => ({ tasks: [task({})] }),
    listTaskThreads: () => ({ taskThreads: [] }),
    listLabels: (input: unknown) => ({
      labels: labels.filter(
        (label) => label.projectId === (input as { projectId: string }).projectId,
      ),
    }),
    createTask: (input: unknown) => {
      const fields = input as Record<string, unknown>;
      createCalls.push(fields);
      return {
        ok: true,
        task: task({ id: "01HZZZZZZZZZZZZZZZZZZZZZT9", key: "ALP-9", title: String(fields.title) }),
      };
    },
    ...extra,
  };
}

async function createFromDialog(slot: ReturnType<typeof renderSlot>) {
  fireEvent.change(await slot.findByLabelText("Task title"), {
    target: { value: "Seeded" },
  });
  fireEvent.click(slot.getByRole("button", { name: "Create task" }));
}

describe("New task from a filtered list", () => {
  // The parent filter keeps what lies under the picked tasks; the fixture task lies under none.
  const FIELD_FILTERS: StoredFilters = { ...MY_FILTERS, parents: [] };

  it("opens with the list's field filters already set and creates the task with them", async () => {
    storeFilters(`project:${PROJECT_A}`, FIELD_FILTERS);
    const createCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: PROJECT_A }, { rpc: rpc(createCalls) });
    await slot.findByText("Existing");

    fireEvent.click(await slot.findByRole("button", { name: /New task/ }));
    const dialog = await slot.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain(ME));
    await createFromDialog(slot);

    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toMatchObject({
      projectId: PROJECT_A,
      status: "in_progress",
      priority: "high",
      type: "feature",
      estimate: "m",
      assignee: ME,
      labelIds: [UI_A],
    });
  });

  it("opens the usual empty draft, with no parent, from an unfiltered list", async () => {
    const createCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: PROJECT_A }, { rpc: rpc(createCalls) });
    await slot.findByText("Existing");

    fireEvent.click(await slot.findByRole("button", { name: /New task/ }));
    await createFromDialog(slot);

    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toMatchObject({
      projectId: PROJECT_A,
      status: "todo",
      priority: "none",
      type: null,
      estimate: null,
      assignee: null,
      parentTaskId: null,
      labelIds: [],
    });
  });

  it("keeps every seeded field editable", async () => {
    storeFilters(`project:${PROJECT_A}`, FIELD_FILTERS);
    const createCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: PROJECT_A }, { rpc: rpc(createCalls) });
    await slot.findByText("Existing");

    fireEvent.click(await slot.findByRole("button", { name: /New task/ }));
    await slot.findByLabelText("Task title");
    fireEvent.click(slot.getByLabelText("Type"));
    fireEvent.click(await slot.findByRole("option", { name: "Bugfix" }));
    fireEvent.click(slot.getByLabelText("Status"));
    fireEvent.click(await slot.findByRole("option", { name: "Backlog" }));
    await createFromDialog(slot);

    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toMatchObject({ type: "bugfix", status: "backlog" });
  });
  it("seeds the dialog the c key opens too", async () => {
    storeFilters(`project:${PROJECT_A}`, { ...NO_FILTERS, assignees: [ME] });
    const createCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: PROJECT_A }, { rpc: rpc(createCalls) });
    await slot.findByText("Existing");

    fireEvent.keyDown(window, { key: "c" });
    await createFromDialog(slot);

    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toMatchObject({ assignee: ME });
  });

  it("opens a saved view's dialog in the view's project", async () => {
    const view = {
      id: VIEW_ID,
      version: 2 as const,
      name: "Beta mine",
      projectId: PROJECT_B,
      listScope: null,
      filters: { ...NO_FILTERS, assignees: [ME] },
      sort: "manual" as const,
      fields: { fields: [], showEmpty: false, showDescription: false },
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const createCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: `view/${VIEW_ID}` },
      {
        rpc: rpc(createCalls, {
          listSavedViews: () => ({ savedViews: [view] }),
          listTasks: () => ({
            tasks: [task({ projectId: PROJECT_B, key: "BET-1", labelIds: [UI_B] })],
          }),
        }),
      },
    );
    await slot.findByText("Existing");

    fireEvent.click(await slot.findByRole("button", { name: /New task/ }));
    await createFromDialog(slot);

    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toMatchObject({ projectId: PROJECT_B, assignee: ME });
  });

  it("re-picks the filtered labels by name when the project changes", async () => {
    storeFilters("all", { ...NO_FILTERS, labelNames: ["ui"] });
    const createCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: rpc(createCalls) });
    await slot.findByText("Existing");

    fireEvent.click(await slot.findByRole("button", { name: /New task/ }));
    await slot.findByLabelText("Task title");
    fireEvent.click(slot.getByLabelText("Project"));
    fireEvent.click(await slot.findByRole("option", { name: "Beta" }));
    await createFromDialog(slot);

    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toMatchObject({ projectId: PROJECT_B, labelIds: [UI_B] });
  });
});

describe("New task from a parent-filtered list", () => {
  const EPIC_ID = `${PROJECT_A}:flow-epic`;

  it("puts a task made in a parent-filtered list under the picked parent", async () => {
    storeFilters(`project:${PROJECT_A}`, { ...NO_FILTERS, parents: [EPIC_ID] });
    const createCalls: Array<Record<string, unknown>> = [];
    const epic = task({ id: EPIC_ID, key: "ALP-2", title: "Flow epic", type: "epic" });
    const inside = task({ parentTaskId: EPIC_ID, epicId: EPIC_ID });
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: PROJECT_A },
      { rpc: rpc(createCalls, { listTasks: () => ({ tasks: [epic, inside] }) }) },
    );
    await slot.findByText("Existing");

    fireEvent.click(await slot.findByRole("button", { name: /New task/ }));
    await createFromDialog(slot);

    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toMatchObject({ parentTaskId: EPIC_ID });
  });
});
